-- =============================================================================
-- Migration: search_unaccent   (Ý #1 — bổ sung)
-- Mục đích : Bỏ dấu ở CẢ HAI PHÍA để gõ không dấu vẫn tìm ra tên có dấu.
--            "Nguyen" → Nguyễn, "Do" → Đỗ, "Le Thi" → Lê Thị.
--
-- Vì sao cần: migration search_prefix_match đã mở cửa thứ ba (khớp tiền tố) cho
-- người gõ dở chừng, nhưng cả ba cửa đều PHÂN BIỆT DẤU:
--   1. FTS      — token 'nguyen' ≠ token 'nguyễn'
--   2. trigram  — 'Nguyen'/'Nguyễn' lệch nhau ở 3/6 ký tự, similarity tụt dưới 0.3
--   3. ILIKE    — chỉ hạ chữ hoa/thường, KHÔNG đụng tới dấu
-- Mà bàn phím mặc định của người dùng thường không gõ dấu. Đây là kiểu truy vấn
-- phổ biến nhất với dữ liệu tiếng Việt, nên nó đáng được chữa tận gốc.
--
-- Cách chữa: chuẩn hoá bỏ dấu ở CẢ dữ liệu LẪN từ khoá rồi mới so sánh. Bỏ dấu
-- hai phía nên vẫn đối xứng: gõ CÓ dấu ('Nguyễn') cũng ra đúng kết quả đó.
--
-- Kiểm chứng trên dữ liệu thật: từ điển unaccent mặc định phủ đủ tiếng Việt, kể
-- cả Đ/đ → D/d (chữ có gạch ngang, không phải dấu thanh, nên không hiển nhiên):
--   unaccent('Đỗ Quang Huy')    → 'Do Quang Huy'
--   unaccent('Lê Thị Thống Kê') → 'Le Thi Thong Ke'
--   unaccent('ưƯơƠăĂâÂêÊôÔ')    → 'uUoOaAaAeEoO'
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. EXTENSION + HÀM BỌC IMMUTABLE
-- -----------------------------------------------------------------------------
create extension if not exists unaccent with schema extensions;

-- Postgres đánh dấu CẢ HAI dạng unaccent() là STABLE chứ không IMMUTABLE, vì kết
-- quả phụ thuộc file từ điển có thể sửa được lúc chạy. Mà index biểu thức BẮT BUỘC
-- phải IMMUTABLE → không dùng trực tiếp unaccent() trong index được.
--
-- Hàm bọc này khai báo IMMUTABLE một cách CÓ CHỦ Ý. Nó hợp lệ vì hai lý do:
--   - gọi dạng 2 tham số với tên từ điển ghi rõ schema, nên kết quả không còn phụ
--     thuộc search_path của người gọi (đó là nguồn "không immutable" thứ nhất);
--   - file từ điển unaccent.rules là dữ liệu tĩnh của bản cài Postgres.
-- ĐÁNH ĐỔI phải nhớ: nếu nâng cấp Postgres major mà bản mới đổi unaccent.rules
-- thì phải REINDEX hai index bên dưới VÀ nạp lại search_vector, nếu không index
-- sẽ lệch âm thầm so với dữ liệu.
create or replace function public.f_unaccent(text)
returns text
language sql
immutable
parallel safe
strict
set search_path = ''
as $$
  select extensions.unaccent('extensions.unaccent'::regdictionary, $1)
$$;

comment on function public.f_unaccent(text) is
  'Bọc unaccent() thành IMMUTABLE để dùng được trong index biểu thức và cột search_vector.';

grant execute on function public.f_unaccent(text) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. search_vector CŨNG PHẢI BỎ DẤU
-- -----------------------------------------------------------------------------
-- Bỏ dấu TRƯỚC khi tách token. Phía truy vấn cũng bỏ dấu trước khi đưa vào
-- websearch_to_tsquery, nên hai bên gặp nhau ở cùng một dạng chuẩn hoá.
-- Vẫn giữ cấu hình 'simple': 'english' sẽ stemming sai với tên tiếng Việt.
create or replace function public.candidates_refresh_search_vector()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.search_vector := to_tsvector(
    'pg_catalog.simple',
    public.f_unaccent(
      coalesce(new.full_name, '') || ' ' ||
      coalesce(new.applied_position, '') || ' ' ||
      coalesce(array_to_string(new.skills, ' '), '')
    )
  );
  return new;
end;
$$;

-- Nạp lại toàn bộ dữ liệu ĐÃ CÓ: search_vector cũ còn dấu nên sẽ không bao giờ
-- khớp tsquery đã bỏ dấu. Bỏ bước này thì FTS im lặng trả về 0 dòng.
update public.candidates set full_name = full_name;

-- -----------------------------------------------------------------------------
-- 3. INDEX TRIGRAM CHUYỂN SANG BIỂU THỨC ĐÃ BỎ DẤU
-- -----------------------------------------------------------------------------
-- Index phải khớp CHÍNH XÁC biểu thức trong mệnh đề WHERE thì planner mới dùng.
-- Truy vấn giờ hỏi f_unaccent(full_name), nên index trên full_name thô thành vô
-- dụng — drop luôn để khỏi tốn chi phí ghi mà không ai đọc.
drop index if exists public.candidates_full_name_trgm_idx;
drop index if exists public.candidates_position_trgm_idx;

create index if not exists candidates_full_name_unaccent_trgm_idx
  on public.candidates using gin (public.f_unaccent(full_name) extensions.gin_trgm_ops);

create index if not exists candidates_position_unaccent_trgm_idx
  on public.candidates using gin (public.f_unaccent(applied_position) extensions.gin_trgm_ops);

-- -----------------------------------------------------------------------------
-- 4. HÀM TÌM KIẾM
-- -----------------------------------------------------------------------------
-- Chữ ký giữ NGUYÊN 10 tham số của migration keyset_pagination → `create or
-- replace` thay đúng hàm cũ, không tạo overload mới, frontend không phải sửa gì.
-- Toàn bộ logic ý #1 + #4 giữ nguyên; thay đổi duy nhất là mọi phép so khớp
-- chuỗi đều chạy trên dạng ĐÃ BỎ DẤU.
create or replace function public.search_candidates(
  p_query             text        default null,   -- từ khoá tự do (FTS + fuzzy + tiền tố)
  -- Bốn tiêu chí lọc đề liệt kê: tên, vị trí, trạng thái, khoảng ngày nộp
  p_name              text        default null,
  p_position          text        default null,
  p_statuses          text[]      default null,
  p_from_date         timestamptz default null,
  p_to_date           timestamptz default null,
  -- Con trỏ trỏ tới dòng CUỐI của trang trước. Cả ba cùng null = trang đầu.
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
  prepared as (
    -- Bỏ dấu từ khoá MỘT LẦN ở đây thay vì lặp lại trong từng điều kiện bên dưới.
    -- f_unaccent là STRICT nên q null → qn null; mọi nhánh dùng qn đều đã được
    -- `p.q is null` chặn trước nên không có nhánh nào so sánh với null.
    select p.q, p.lim, public.f_unaccent(p.q) as qn
    from params p
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
              0.50 * ts_rank(c.search_vector, websearch_to_tsquery('simple', p.qn))::numeric
            + 0.30 * greatest(
                       similarity(public.f_unaccent(c.full_name), p.qn),
                       similarity(public.f_unaccent(c.applied_position), p.qn)
                     )::numeric
            + 0.20 * (case when public.f_unaccent(c.full_name)        ilike p.qn || '%'
                             or public.f_unaccent(c.applied_position) ilike p.qn || '%'
                           then 1 else 0 end)::numeric
        end
      ), 6) as score
    from public.candidates c
    cross join prepared p
    where
      -- Không có từ khoá → lấy tất cả.
      -- Có từ khoá → khớp FTS HOẶC gần đúng HOẶC bắt đầu bằng từ khoá.
      (
        p.q is null
        -- search_vector đã bỏ dấu ở trigger, tsquery bỏ dấu ở đây → cùng dạng.
        or c.search_vector @@ websearch_to_tsquery('simple', p.qn)
        or public.f_unaccent(c.full_name)        % p.qn
        or public.f_unaccent(c.applied_position) % p.qn
        -- Cửa thứ ba: khớp tiền tố, neo trái nên index trigram GIN vẫn dùng được.
        or public.f_unaccent(c.full_name)        ilike p.qn || '%'
        or public.f_unaccent(c.applied_position) ilike p.qn || '%'
      )
      -- Bốn tiêu chí lọc kết hợp bằng AND; null = "không lọc theo tiêu chí này".
      -- Hai ô lọc tên/vị trí cũng bỏ dấu cho nhất quán với ô từ khoá: nếu chỉ ô
      -- từ khoá bỏ dấu thì cùng một chuỗi "Nguyen" lại cho hai kết quả khác nhau
      -- tuỳ người dùng gõ vào ô nào — bẫy khó hiểu hơn là không hỗ trợ hẳn.
      and (p_name      is null or public.f_unaccent(c.full_name)
                                    ilike '%' || public.f_unaccent(p_name)     || '%')
      and (p_position  is null or public.f_unaccent(c.applied_position)
                                    ilike '%' || public.f_unaccent(p_position) || '%')
      and (p_statuses  is null or c.status = any (p_statuses))
      and (p_from_date is null or c.created_at >= p_from_date)
      and (p_to_date   is null or c.created_at <  p_to_date)   -- nửa mở: [from, to)
  )
  select m.id, m.full_name, m.applied_position, m.status,
         m.resume_url, m.skills, m.created_at, m.score
  from matched m
  where
    -- Keyset pagination — lấy các dòng đứng SAU con trỏ theo đúng thứ tự sắp xếp.
    --   (a,b,c) < (x,y,z)  ≡  a<x or (a=x and b<y) or (a=x and b=y and c<z)
    -- Bộ ba là TOTAL ORDERING vì id là khoá chính → không bao giờ lặp hay sót.
    p_cursor_id is null
    or (m.score, m.created_at, m.id) < (p_cursor_score, p_cursor_created_at, p_cursor_id)
  -- Thứ tự PHẢI khớp CHÍNH XÁC với bộ ba trong mệnh đề where ở trên.
  order by m.score desc, m.created_at desc, m.id desc
  limit (select lim from params);
$$;

comment on function public.search_candidates is
  'Ý #1 + #4 — Tìm ứng viên: full-text + fuzzy + khớp tiền tố, không phân biệt dấu, lọc 4 tiêu chí, xếp hạng, phân trang keyset.';

-- create or replace giữ nguyên quyền đã cấp, nhưng lặp lại cho rõ ràng và để
-- migration này tự đứng vững nếu chạy trên database sạch.
grant execute on function public.search_candidates(
  text, text, text, text[], timestamptz, timestamptz, numeric, timestamptz, uuid, int
) to authenticated;
