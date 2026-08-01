-- =============================================================================
-- Migration: init_candidates
-- Mục đích : Tạo bảng candidates + ràng buộc + index + trigger + RLS + Realtime
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. BẢNG CHÍNH
-- -----------------------------------------------------------------------------
create table if not exists public.candidates (
  id                uuid        primary key default gen_random_uuid(),

  -- Khoá ngoại tới bảng user của Supabase Auth.
  -- on delete cascade: xoá user thì hồ sơ do họ quản lý cũng bị xoá theo.
  user_id           uuid        not null references auth.users (id) on delete cascade,

  full_name         text        not null,
  applied_position  text        not null,

  -- Trạng thái tuyển dụng. Ràng buộc ở tầng DB để dữ liệu không bao giờ sai,
  -- kể cả khi ai đó gọi thẳng REST API và bỏ qua frontend + Edge Function.
  status            text        not null default 'New',

  -- Đường dẫn object trong Storage bucket 'resumes', dạng "<user_id>/<uuid>.pdf".
  -- Cố ý KHÔNG lưu URL đầy đủ: bucket là private, link tải được tạo động
  -- bằng createSignedUrl() và có thời hạn. Xem README để biết lý do.
  resume_url        text,

  -- Kỹ năng — phục vụ full-text search và thuật toán gợi ý (/recommend).
  skills            text[]      not null default '{}',

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint candidates_full_name_len
    check (char_length(btrim(full_name)) between 2 and 120),

  constraint candidates_applied_position_len
    check (char_length(btrim(applied_position)) between 2 and 120),

  constraint candidates_status_valid
    check (status in ('New', 'Interviewing', 'Hired', 'Rejected'))
);

comment on table  public.candidates            is 'Hồ sơ ứng viên do một nhân viên HR quản lý. Cô lập theo user bằng RLS.';
comment on column public.candidates.user_id    is 'Chủ sở hữu bản ghi. Mọi RLS policy đều so khớp cột này với auth.uid().';
comment on column public.candidates.resume_url is 'Object path trong bucket private "resumes" (không phải URL công khai).';

-- -----------------------------------------------------------------------------
-- 2. INDEX
-- -----------------------------------------------------------------------------

-- Index chính cho màn hình danh sách:
--   WHERE user_id = ?  ORDER BY created_at DESC, id DESC
-- Thứ tự cột khớp chính xác truy vấn nên Postgres không cần bước sort riêng.
-- Đây cũng là index mà cursor pagination ở Bước 8 sẽ dùng.
create index if not exists candidates_user_created_idx
  on public.candidates (user_id, created_at desc, id desc);

-- Phục vụ lọc theo trạng thái và thống kê /analytics.
create index if not exists candidates_user_status_idx
  on public.candidates (user_id, status);

-- -----------------------------------------------------------------------------
-- 3. TRIGGER updated_at
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker      -- chạy bằng quyền người gọi, KHÔNG bỏ qua RLS
set search_path = ''  -- chống tấn công search_path hijacking
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists candidates_set_updated_at on public.candidates;
create trigger candidates_set_updated_at
  before update on public.candidates
  for each row
  execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 4. ROW-LEVEL SECURITY
-- -----------------------------------------------------------------------------
-- Bật RLS. Sau lệnh này, khi CHƯA có policy nào thì bảng bị chặn hoàn toàn
-- với anon/authenticated (fail-closed) — đây là hành vi mong muốn.
alter table public.candidates enable row level security;

-- Viết 4 policy riêng cho từng thao tác thay vì một policy FOR ALL:
--   - rõ ràng hơn khi đọc và khi review bảo mật
--   - INSERT chỉ cần WITH CHECK, SELECT/DELETE chỉ cần USING → tách ra mới đúng ngữ nghĩa
--
-- Lưu ý: viết (select auth.uid()) thay vì auth.uid() là tối ưu hiệu năng chính thức
-- của Supabase — Postgres coi đây là InitPlan, gọi 1 lần rồi cache, thay vì gọi lại
-- cho từng dòng.

drop policy if exists "candidates_select_own" on public.candidates;
create policy "candidates_select_own"
  on public.candidates
  for select
  to authenticated
  using ( (select auth.uid()) = user_id );

drop policy if exists "candidates_insert_own" on public.candidates;
create policy "candidates_insert_own"
  on public.candidates
  for insert
  to authenticated
  with check ( (select auth.uid()) = user_id );

-- UPDATE bắt buộc phải có CẢ USING lẫn WITH CHECK:
--   USING      -> chỉ được sửa dòng mình đang sở hữu
--   WITH CHECK -> sau khi sửa vẫn phải thuộc về mình
-- Thiếu WITH CHECK, user A có thể chạy
--   UPDATE candidates SET user_id = '<id của B>' ...
-- để "tặng" bản ghi sang tài khoản khác. Đây là lỗ hổng thật, rất hay gặp.
drop policy if exists "candidates_update_own" on public.candidates;
create policy "candidates_update_own"
  on public.candidates
  for update
  to authenticated
  using      ( (select auth.uid()) = user_id )
  with check ( (select auth.uid()) = user_id );

drop policy if exists "candidates_delete_own" on public.candidates;
create policy "candidates_delete_own"
  on public.candidates
  for delete
  to authenticated
  using ( (select auth.uid()) = user_id );

-- -----------------------------------------------------------------------------
-- 5. GRANT — quyền truy cập bảng ở tầng Postgres
-- -----------------------------------------------------------------------------
-- Từ 30/05/2026 Supabase không còn tự động cấp quyền cho bảng mới trong schema
-- public. GRANT và RLS là HAI LỚP KHÁC NHAU:
--     GRANT -> "role này có được chạm vào bảng không?"
--     RLS   -> "trong bảng đó, thấy được những dòng nào?"
-- Thiếu GRANT thì dù RLS hoàn hảo, frontend vẫn nhận lỗi permission denied.
grant select, insert, update, delete on table public.candidates to authenticated;

-- CỐ Ý không cấp quyền cho role anon: chưa đăng nhập thì không được chạm vào bảng.

-- -----------------------------------------------------------------------------
-- 6. REALTIME
-- -----------------------------------------------------------------------------
-- replica identity full: để payload.old có dữ liệu khi UPDATE.
-- Lưu ý: khi RLS đang bật, payload.old của DELETE chỉ chứa khoá chính (id) —
-- như vậy là đủ để gỡ dòng khỏi danh sách trên UI.
alter table public.candidates replica identity full;

-- Đưa bảng vào publication mà Realtime theo dõi.
-- Bọc trong khối kiểm tra để migration chạy lại lần 2 không báo lỗi
-- "table is already member of publication".
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'candidates'
  ) then
    alter publication supabase_realtime add table public.candidates;
  end if;
end $$;
