-- =============================================================================
-- Migration: fix_candidates_grants
-- Bối cảnh : Project này vẫn còn ALTER DEFAULT PRIVILEGES cũ (từ role postgres
--            và supabase_admin) tự động cấp full quyền (SELECT/INSERT/UPDATE/
--            DELETE/TRUNCATE/REFERENCES/TRIGGER) cho CẢ anon lẫn authenticated
--            trên mọi bảng mới tạo trong schema public — kể cả sau ngày
--            30/05/2026 mà đáng lẽ hành vi này đã bị tắt. Phát hiện qua
--            information_schema.role_table_grants khi verify (V2.5).
-- Mục đích : Thu hồi hết quyền của anon (chưa đăng nhập = không được chạm bảng),
--            và giới hạn authenticated chỉ còn đúng 4 quyền cần dùng.
-- =============================================================================

revoke all on table public.candidates from anon;

revoke all on table public.candidates from authenticated;
grant select, insert, update, delete on table public.candidates to authenticated;
