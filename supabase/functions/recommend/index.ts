/**
 * POST /functions/v1/recommend
 *
 * Body: {
 *   position: string,
 *   required_skills?: string[],
 *   preferred_skills?: string[],
 *   limit?: number            // mặc định 3, tối đa 10
 * }
 *
 * Gợi ý các ứng viên tiềm năng nhất cho một vị trí.
 *
 * Thuật toán chấm điểm nằm ở _shared/matching.ts (ý #5) và được dùng chung với
 * frontend — endpoint này chỉ lo xác thực, validate, truy vấn và chọn top-K.
 * RLS giới hạn phạm vi trong hồ sơ của chính người gọi.
 */
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { topMatches } from "../_shared/matching-topk.ts";
import type { JobRequirement } from "../_shared/matching.ts";
import type { Database } from "../_shared/database.types.ts";

/** Giới hạn an toàn để một lời gọi không kéo cả kho hồ sơ về function. */
const MAX_ROWS = 5_000;

const DEFAULT_LIMIT = 3;
const MAX_LIMIT = 10;

/** Lọc lấy đúng phần tử kiểu string — body đến từ client nên không tin được. */
const toStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

export default {
  fetch: withSupabase<Database>({ auth: "user" }, async (req, ctx) => {
    // --- 1. Chỉ nhận POST ---
    if (req.method !== "POST") {
      return Response.json({ error: "Chỉ chấp nhận method POST." }, { status: 405 });
    }

    // --- 2. Đọc body ---
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return Response.json({ error: "Body không phải JSON hợp lệ." }, { status: 400 });
    }

    // --- 3. Validate ---
    const position = typeof body.position === "string" ? body.position.trim() : "";
    if (position.length < 2) {
      return Response.json(
        { error: "position là bắt buộc (tối thiểu 2 ký tự)." },
        { status: 400 },
      );
    }

    const job: JobRequirement = {
      position,
      requiredSkills: toStringArray(body.required_skills),
      preferredSkills: toStringArray(body.preferred_skills),
    };

    // Kẹp limit vào [1, 10]: Number('abc') = NaN, NaN || 3 → 3.
    const limit = Math.min(Math.max(Number(body.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);

    // --- 4. Truy vấn (RLS lọc sẵn theo người gọi) ---
    // Không lọc Rejected ở đây: engine đã cho trạng thái đó trọng số 0 nên ứng
    // viên bị loại tự rơi khỏi kết quả. Giữ MỘT chỗ quyết định duy nhất.
    const { data, error } = await ctx.supabase
      .from("candidates")
      .select("id, full_name, applied_position, status, skills, created_at")
      .limit(MAX_ROWS);

    if (error) {
      console.error("[recommend] query lỗi:", error);
      return Response.json({ error: "Không lấy được dữ liệu." }, { status: 500 });
    }

    const candidates = data ?? [];

    // --- 5. Chấm điểm + chọn top-K ---
    const recommendations = topMatches(candidates, job, limit);

    return Response.json({
      data: {
        job,
        evaluated: candidates.length,
        truncated: candidates.length === MAX_ROWS,
        recommendations: recommendations.map((result) => ({
          ...result.candidate,
          score: result.score,
          breakdown: result.breakdown,
          matched_required: result.matchedRequired,
          missing_required: result.missingRequired,
          matched_preferred: result.matchedPreferred,
        })),
      },
    });
  }),
};
