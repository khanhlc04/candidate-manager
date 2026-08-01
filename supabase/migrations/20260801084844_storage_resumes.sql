-- =============================================================================
-- Migration: storage_resumes
-- Mục đích : Tạo bucket 'resumes' (PRIVATE) và các RLS policy cô lập theo user
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. BUCKET
-- -----------------------------------------------------------------------------
-- public = false  → file chỉ truy cập được qua signed URL có thời hạn.
--                   CV chứa dữ liệu cá nhân (họ tên, SĐT, địa chỉ, lịch sử làm việc)
--                   nên không được để public vĩnh viễn.
-- file_size_limit / allowed_mime_types là chốt chặn phía SERVER,
--                   không thể bị bỏ qua kể cả khi gọi API trực tiếp.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'resumes',
  'resumes',
  false,
  5242880,                          -- 5 MB
  array['application/pdf']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- -----------------------------------------------------------------------------
-- 2. RLS POLICY TRÊN storage.objects
-- -----------------------------------------------------------------------------
-- Quy ước đường dẫn: "<user_id>/<uuid>.pdf"
-- storage.foldername(name)[1] lấy ra thư mục cấp 1 và so với auth.uid().
-- (RLS trên storage.objects đã được Supabase bật sẵn.)

-- 2a. UPLOAD — chỉ được ghi vào thư mục mang tên chính mình
drop policy if exists "resumes_insert_own_folder" on storage.objects;
create policy "resumes_insert_own_folder"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- 2b. ĐỌC — cần cho createSignedUrl() và download()
drop policy if exists "resumes_select_own_folder" on storage.objects;
create policy "resumes_select_own_folder"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- 2c. GHI ĐÈ (upsert) — cần cả USING lẫn WITH CHECK,
--     nếu không user có thể "di chuyển" file sang thư mục người khác.
drop policy if exists "resumes_update_own_folder" on storage.objects;
create policy "resumes_update_own_folder"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- 2d. XOÁ — dùng khi xoá hồ sơ thì dọn luôn file CV
drop policy if exists "resumes_delete_own_folder" on storage.objects;
create policy "resumes_delete_own_folder"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Cố ý KHÔNG có policy nào cho role anon:
-- người chưa đăng nhập không upload, không đọc, không xoá được gì.
