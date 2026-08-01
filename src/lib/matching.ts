/**
 * Tái xuất thuật toán chấm điểm phù hợp (ý #5).
 *
 * File gốc nằm ở supabase/functions/_shared/matching.ts và được Edge Function
 * /recommend dùng chung — giữ MỘT nguồn sự thật duy nhất thay vì copy hai bản
 * rồi lệch nhau. File gốc không import gì nên chạy được ở cả Deno lẫn trình duyệt.
 */
export * from '../../supabase/functions/_shared/matching'
