-- =============================================================================
-- Migration: search_and_ranking   (Ý #1)
-- Mục đích : Full-text search + tìm gần đúng + lọc 4 tiêu chí + xếp hạng
-- Ghi chú  : Phân trang cursor được thêm ở migration sau (ý #4).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. EXTENSION cho tìm kiếm gần đúng
-- -----------------------------------------------------------------------------
create extension if not exists pg_trgm with schema extensions;

-- -----------------------------------------------------------------------------
-- 2. CỘT search_vector
-- -----------------------------------------------------------------------------
-- Dùng TRIGGER thay vì GENERATED COLUMN vì array_to_string() được Postgres đánh
-- dấu STABLE (không phải IMMUTABLE), mà generated column bắt buộc biểu thức phải
-- IMMUTABLE. Trigger không có ràng buộc đó.
alter table public.candidates
  add column if not exists search_vector tsvector;

-- Cấu hình 'simple' thay vì 'english': 'english' stemming theo tiếng Anh và loại
-- stop-word — sai với tên tiếng Việt. 'simple' chỉ tách từ + hạ chữ thường.
create or replace function public.candidates_refresh_search_vector()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.search_vector := to_tsvector(
    'pg_catalog.simple',
    coalesce(new.full_name, '') || ' ' ||
    coalesce(new.applied_position, '') || ' ' ||
    coalesce(array_to_string(new.skills, ' '), '')
  );
  return new;
end;
$$;

drop trigger if exists candidates_search_vector_trg on public.candidates;
create trigger candidates_search_vector_trg
  before insert or update of full_name, applied_position, skills
  on public.candidates
  for each row
  execute function public.candidates_refresh_search_vector();

-- Nạp lại cho dữ liệu ĐÃ CÓ (trigger chỉ chạy từ giờ trở đi).
-- UPDATE OF kích hoạt khi cột được nhắc trong SET, kể cả gán lại chính nó.
update public.candidates set full_name = full_name;

-- -----------------------------------------------------------------------------
-- 3. INDEX cho tìm kiếm
-- -----------------------------------------------------------------------------
-- GIN trên tsvector: tra cứu full-text nhanh (index đảo ngược token → dòng).
create index if not exists candidates_search_vector_idx
  on public.candidates using gin (search_vector);

-- GIN trigram: tăng tốc similarity() và toán tử % (tìm gần đúng).
create index if not exists candidates_full_name_trgm_idx
  on public.candidates using gin (full_name extensions.gin_trgm_ops);

create index if not exists candidates_position_trgm_idx
  on public.candidates using gin (applied_position extensions.gin_trgm_ops);

-- -----------------------------------------------------------------------------
-- 4. HÀM TÌM KIẾM: lọc 4 tiêu chí + full-text + fuzzy + xếp hạng
-- -----------------------------------------------------------------------------
-- security invoker (mặc định) → RLS của NGƯỜI GỌI vẫn áp dụng.
-- TUYỆT ĐỐI KHÔNG dùng security definer ở đây: nó chạy bằng quyền người tạo hàm
-- nên sẽ bỏ qua RLS và cho user A đọc được hồ sơ của user B.
create or replace function public.search_candidates(
  p_query     text        default null,   -- từ khoá tự do (FTS + fuzzy)
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
      -- Không có từ khoá → lấy tất cả. Có từ khoá → khớp FTS HOẶC khớp gần đúng.
      (
        p.q is null
        or c.search_vector @@ websearch_to_tsquery('simple', p.q)
        or c.full_name % p.q
        or c.applied_position % p.q
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
  'Ý #1 — Tìm ứng viên: full-text + fuzzy + lọc 4 tiêu chí, xếp hạng theo điểm liên quan.';

-- -----------------------------------------------------------------------------
-- 5. GRANT
-- -----------------------------------------------------------------------------
-- Từ 30/05/2026, hàm mới KHÔNG còn được tự động cấp quyền cho authenticated.
-- Phải liệt kê đúng danh sách kiểu tham số vì Postgres cho phép overload.
grant execute on function public.search_candidates(
  text, text, text, text[], timestamptz, timestamptz, int
) to authenticated;
