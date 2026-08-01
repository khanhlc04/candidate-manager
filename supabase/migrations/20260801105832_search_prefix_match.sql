-- =============================================================================
-- Migration: search_prefix_match   (Ý #1 — bổ sung)
-- Mục đích : Cho khớp TIỀN TỐ trở thành một điều kiện LỌC, không chỉ là điểm cộng.
--
-- Vì sao cần: ở bản trước, số hạng `0.20 × (bắt đầu bằng từ khoá)` chỉ nằm trong
-- công thức tính ĐIỂM — nó xếp lại thứ tự các dòng đã lọt vào kết quả, chứ không
-- kéo được dòng nào vào. Mà mệnh đề WHERE chỉ có hai cửa vào:
--   1. FTS  — phải khớp NGUYÊN token ('nguy' không khớp token 'nguyễn')
--   2. `%`  — trigram phải giống ≥ 0.3 (chuỗi ngắn như 'Nguy' không đạt)
-- Hệ quả: gõ 'Nguy' hay 'Front' trả về 0 dòng, nên trọng số tiền tố không bao
-- giờ có cơ hội phát huy. Migration này mở CỬA THỨ BA cho đúng ý định thiết kế.
--
-- Chữ ký hàm giữ NGUYÊN → `create or replace` thay thế đúng hàm cũ, không tạo
-- overload mới (xem bảng lỗi thường gặp của ý #1).
--
-- Ghi chú phạm vi: chỉ chữa "gõ dở chừng" (Nguy, Front). KHÔNG chữa "gõ thiếu
-- dấu" (Nguyen → Nguyễn) vì ILIKE phân biệt dấu; việc đó cần extension unaccent
-- và là một thay đổi lớn hơn, cố ý để ngoài migration này.
-- =============================================================================

create or replace function public.search_candidates(
  p_query     text        default null,   -- từ khoá tự do (FTS + fuzzy + tiền tố)
  -- Bốn tiêu chí lọc đề liệt kê: tên, vị trí, trạng thái, khoảng ngày nộp
  p_name      text        default null,
  p_position  text        default null,
  p_statuses  text[]      default null,
  p_from_date timestamptz default null,
  p_to_date   timestamptz default null,
  p_limit     int         default 20
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
      -- Điểm liên quan có trọng số. Làm tròn 6 chữ số để giá trị ổn định khi đi
      -- qua JSON (ý #4 sẽ dùng chính con số này làm con trỏ phân trang).
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
        -- Cửa thứ ba: khớp tiền tố. Cần thiết vì FTS chỉ khớp nguyên token còn
        -- trigram thì chuỗi càng ngắn similarity càng thấp — đúng hai điểm yếu
        -- xuất hiện khi người dùng mới gõ được vài ký tự đầu.
        -- Neo trái ('abc%', không phải '%abc%') nên index trigram GIN vẫn dùng được.
        or c.full_name        ilike p.q || '%'
        or c.applied_position ilike p.q || '%'
      )
      -- Bốn tiêu chí lọc kết hợp bằng AND; null = "không lọc theo tiêu chí này".
      -- Mẫu `(p_x is null or <điều kiện>)` cho phép 16 tổ hợp mà chỉ cần MỘT hàm,
      -- thay vì sinh SQL động (dễ dính SQL injection).
      and (p_name      is null or c.full_name        ilike '%' || p_name     || '%')
      and (p_position  is null or c.applied_position ilike '%' || p_position || '%')
      and (p_statuses  is null or c.status = any (p_statuses))
      and (p_from_date is null or c.created_at >= p_from_date)
      and (p_to_date   is null or c.created_at <  p_to_date)   -- nửa mở: [from, to)
  )
  select m.id, m.full_name, m.applied_position, m.status,
         m.resume_url, m.skills, m.created_at, m.score
  from matched m
  -- Bộ ba này là TOTAL ORDERING (id là khoá chính) → cùng dữ liệu luôn ra cùng
  -- thứ tự. Ý #4 sẽ dựa hẳn vào tính chất đó để phân trang.
  order by m.score desc, m.created_at desc, m.id desc
  limit (select lim from params);
$$;

comment on function public.search_candidates is
  'Ý #1 — Tìm ứng viên: full-text + fuzzy + khớp tiền tố + lọc 4 tiêu chí, xếp hạng theo điểm liên quan.';

-- create or replace giữ nguyên quyền đã cấp, nhưng lặp lại cho rõ ràng và để
-- migration này tự đứng vững nếu chạy trên database sạch.
grant execute on function public.search_candidates(
  text, text, text, text[], timestamptz, timestamptz, int
) to authenticated;
