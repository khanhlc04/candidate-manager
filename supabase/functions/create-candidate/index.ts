/**
 * POST /functions/v1/create-candidate
 *
 * Tạo một hồ sơ ứng viên mới.
 *
 * Bảo mật:
 *   - auth: 'user'  → withSupabase xác thực JWT và trả 401 nếu không hợp lệ.
 *   - user_id lấy TỪ TOKEN, không lấy từ body → client không thể mạo danh.
 *   - ctx.supabase mang JWT của người gọi → RLS vẫn là hàng rào cuối cùng
 *     (cố ý KHÔNG dùng service_role, vì nó bỏ qua RLS).
 */
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { validateCreateCandidate } from "../_shared/validation.ts";
import type { Database } from "../_shared/database.types.ts";

function jsonError(message: string, status: number, details?: string[]) {
  return Response.json({ error: message, ...(details ? { details } : {}) }, { status });
}

export default {
  fetch: withSupabase<Database>({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") {
      return jsonError("Chỉ chấp nhận method POST.", 405);
    }

    // --- 1. Đọc body ---
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return jsonError("Body không phải JSON hợp lệ.", 400);
    }

    // --- 2. Danh tính lấy từ JWT đã xác thực ---
    const userId = ctx.userClaims?.id;
    if (!userId) return jsonError("Không xác định được người dùng.", 401);

    // --- 3. Validate ---
    const result = validateCreateCandidate(body, userId);
    if (!result.ok) {
      return jsonError("Dữ liệu không hợp lệ.", 400, result.errors);
    }

    // --- 4. Ghi vào database (RLS vẫn áp dụng) ---
    const { data, error } = await ctx.supabase
      .from("candidates")
      .insert({ ...result.value, user_id: userId })
      .select()
      .single();

    if (error) {
      console.error("[create-candidate] insert lỗi:", error);

      // 42501 = insufficient_privilege → RLS từ chối
      if (error.code === "42501") {
        return jsonError("Bạn không có quyền tạo hồ sơ này.", 403);
      }
      // 23514 = check_violation → vi phạm CHECK constraint
      if (error.code === "23514") {
        return jsonError("Dữ liệu vi phạm ràng buộc của database.", 400);
      }
      return jsonError("Không tạo được hồ sơ ứng viên.", 500);
    }

    return Response.json({ data }, { status: 201 });
  }),
};
