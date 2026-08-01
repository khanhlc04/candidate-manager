import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Fail-fast: báo lỗi rõ ràng ngay lúc khởi động thay vì lỗi khó hiểu ở giữa app
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Thiếu biến môi trường. Hãy tạo file .env.local với VITE_SUPABASE_URL và VITE_SUPABASE_ANON_KEY ' +
      '(xem .env.example), rồi khởi động lại dev server.',
  )
}

/**
 * Client dùng chung cho toàn app.
 *
 * Chỉ tạo MỘT instance duy nhất: mỗi instance mở một kết nối Realtime riêng và
 * quản lý một bộ token riêng — tạo nhiều lần sẽ gây rò rỉ WebSocket và session lệch nhau.
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,      // lưu session vào localStorage → F5 không bị đăng xuất
    autoRefreshToken: true,    // tự gia hạn access_token trước khi hết hạn (~1 giờ)
    detectSessionInUrl: true,  // xử lý token trả về qua URL (magic link, OAuth)
  },
})
