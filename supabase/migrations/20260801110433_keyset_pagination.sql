-- =============================================================================
-- Migration: keyset_pagination   (Ý #4)
-- Mục đích : Thay OFFSET bằng phân trang cursor trên total ordering
--
-- Vì sao KHÔNG dùng OFFSET:
--   1. Dữ liệu trôi — Realtime đang bật, ai đó chèn/xoá một dòng giữa hai lần
--      lật trang thì OFFSET n trỏ vào chỗ khác: dòng bị LẶP hoặc bị SÓT im lặng.
--   2. Chậm dần — OFFSET n buộc Postgres đọc rồi VỨT BỎ n dòng: O(offset + limit)
--      thay vì O(log n + limit).
-- Keyset không mắc cả hai vì nó hỏi "các dòng đứng SAU dòng này", không phải
-- "bỏ qua n dòng". Đánh đổi: không nhảy được tới trang bất kỳ — giao diện
-- "Tải thêm" của bài này không cần điều đó.
--
-- Bản này GIỮ NGUYÊN toàn bộ logic của ý #1 (FTS + trigram + khớp tiền tố +
-- 4 tiêu chí lọc + công thức điểm), chỉ thêm 3 tham số con trỏ và mệnh đề keyset.
-- =============================================================================

-- create or replace với DANH SÁCH THAM SỐ KHÁC sẽ tạo overload MỚI chứ không
-- thay thế bản cũ → database có 2 hàm cùng tên, lời gọi RPC có thể rơi vào bản
-- cũ ("function is not unique"). Phải drop đúng chữ ký cũ 7 tham số trước.
drop function if exists public.search_candidates(
  text, text, text, text[], timestamptz, timestamptz, int
);

create or replace function public.search_candidates(
  p_query             text        default null,   -- từ khoá tự do (FTS + fuzzy + tiền tố)
  -- Bốn tiêu chí lọc đề liệt kê: tên, vị trí, trạng thái, khoảng ngày nộp
  p_name              text        default null,
  p_position          text        default null,
  p_statuses          text[]      default null,
  p_from_date         timestamptz default null,
  p_to_date           timestamptz default null,
  -- MỚI (1): con trỏ trỏ tới dòng CUỐI của trang trước. Cả ba cùng null = trang đầu.
  p_cursor_score      numeric     default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id         uuid        default null,
  p_limit             int         default 20
)
returns table (
  id               uuid,
  full_name        text,
  applied_position text,
  status           text,
  resume_url       text,
  skills           text[],
  created_at       timestamptz,
  score            numeric
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with params as (
    select
      nullif(btrim(coalesce(p_query, '')), '')      as q,
      least(greatest(coalesce(p_limit, 20), 1), 50) as lim   -- chặn trên chống lạm dụng
  ),
  matched as (
    select
      c.id, c.full_name, c.applied_position, c.status,
      c.resume_url, c.skills, c.created_at,
      -- round(…, 6) là điều kiện SỐNG CÒN của phân trang: score đi một vòng
      -- Postgres → JSON → JavaScript → JSON → Postgres rồi quay lại làm con trỏ.
      -- Không làm tròn thì sai số dấu phẩy động khiến phép so sánh trượt → MẤT DÒNG.
      round((
        case
          when p.q is null then 0::numeric
          else
              0.50 * ts_rank(c.search_vector, websearch_to_tsquery('simple', p.q))::numeric
            + 0.30 * greatest(
                       similarity(c.full_name, p.q),
                       similarity(c.applied_position, p.q)
                     )::numeric
            + 0.20 * (case when c.full_name ilike p.q || '%'
                             or c.applied_position ilike p.q || '%'
                           then 1 else 0 end)::numeric
        end
      ), 6) as score
    from public.candidates c
    cross join params p
    where
      -- Không có từ khoá → lấy tất cả.
      -- Có từ khoá → khớp FTS HOẶC gần đúng HOẶC bắt đầu bằng từ khoá.
      (
        p.q is null
        or c.search_vector @@ websearch_to_tsquery('simple', p.q)
        or c.full_name % p.q
        or c.applied_position % p.q
        -- Cửa thứ ba (giữ từ migration search_prefix_match): khớp tiền tố, neo
        -- trái nên index trigram GIN vẫn dùng được.
        or c.full_name        ilike p.q || '%'
        or c.applied_position ilike p.q || '%'
      )
      -- Bốn tiêu chí lọc kết hợp bằng AND; null = "không lọc theo tiêu chí này".
      and (p_name      is null or c.full_name        ilike '%' || p_name     || '%')
      and (p_position  is null or c.applied_position ilike '%' || p_position || '%')
      and (p_statuses  is null or c.status = any (p_statuses))
      and (p_from_date is null or c.created_at >= p_from_date)
      and (p_to_date   is null or c.created_at <  p_to_date)   -- nửa mở: [from, to)
  )
  select m.id, m.full_name, m.applied_position, m.status,
         m.resume_url, m.skills, m.created_at, m.score
  from matched m
  where
    -- MỚI (2): Keyset pagination — lấy các dòng đứng SAU con trỏ theo đúng thứ tự
    -- sắp xếp. So sánh bộ giá trị (row-value comparison) thay cho 3 tầng OR lồng:
    --   (a,b,c) < (x,y,z)  ≡  a<x or (a=x and b<y) or (a=x and b=y and c<z)
    -- Bộ ba là TOTAL ORDERING vì id là khoá chính (duy nhất tuyệt đối) → hai hồ sơ
    -- trùng cả score lẫn created_at vẫn phân biệt được → không bao giờ lặp hay sót.
    p_cursor_id is null
    or (m.score, m.created_at, m.id) < (p_cursor_score, p_cursor_created_at, p_cursor_id)
  -- MỚI (3): thứ tự PHẢI khớp CHÍNH XÁC với bộ ba trong mệnh đề where ở trên.
  -- Lệch một cột là phân trang sai ngay, và chỉ lộ ra khi có dòng bằng điểm.
  order by m.score desc, m.created_at desc, m.id desc
  limit (select lim from params);
$$;

comment on function public.search_candidates is
  'Ý #1 + #4 — Tìm ứng viên: full-text + fuzzy + khớp tiền tố + lọc 4 tiêu chí, xếp hạng, phân trang keyset.';

-- Chữ ký đổi → phải grant lại (bản cũ đã bị drop cùng quyền của nó).
grant execute on function public.search_candidates(
  text, text, text, text[], timestamptz, timestamptz, numeric, timestamptz, uuid, int
) to authenticated;
