/**
 * GET|POST /functions/v1/analytics
 *
 * Trả về thống kê hồ sơ ứng viên của CHÍNH người gọi (RLS đảm bảo điều đó):
 *   - tổng số ứng viên
 *   - tỷ lệ theo từng trạng thái
 *   - top 3 vị trí có nhiều ứng viên nhất
 *   - số ứng viên mới trong 7 ngày gần nhất
 *
 * Toàn bộ tính trong MỘT lần duyệt O(n); top-3 dùng thuật toán top-K O(m·k)
 * thay vì sort O(m log m).
 *
 * Chấp nhận cả GET (tiện curl) lẫn POST (supabase.functions.invoke mặc định POST).
 */
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { topK } from "../_shared/stats.ts";
import type { Database } from "../_shared/database.types.ts";

const STATUSES = ["New", "Interviewing", "Hired", "Rejected"] as const;
type Status = (typeof STATUSES)[number];

/** Giới hạn an toàn: tránh kéo toàn bộ bảng nếu dữ liệu lớn bất thường. */
const MAX_ROWS = 10_000;

/** Làm tròn 1 chữ số thập phân, tránh chia 0 khi chưa có dữ liệu. */
const percent = (part: number, total: number): number =>
  total === 0 ? 0 : Math.round((part / total) * 1000) / 10;

export default {
  fetch: withSupabase<Database>({ auth: "user" }, async (_req, ctx) => {
    // Chỉ lấy 3 cột cần cho thống kê — giảm băng thông đáng kể so với select('*').
    const { data, error } = await ctx.supabase
      .from("candidates")
      .select("status, applied_position, created_at")
      .limit(MAX_ROWS);

    if (error) {
      console.error("[analytics] query lỗi:", error);
      return Response.json({ error: "Không lấy được dữ liệu thống kê." }, { status: 500 });
    }

    const rows = data ?? [];
    const total = rows.length;

    // ---------- MỘT lần duyệt, gom hết mọi chỉ số ----------
    const byStatus: Record<Status, number> = { New: 0, Interviewing: 0, Hired: 0, Rejected: 0 };
    const byPosition = new Map<string, number>();

    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    let recentCount = 0;

    for (const row of rows) {
      const status = row.status as Status;
      if (status in byStatus) byStatus[status] += 1;

      byPosition.set(row.applied_position, (byPosition.get(row.applied_position) ?? 0) + 1);

      if (new Date(row.created_at).getTime() >= sevenDaysAgo) recentCount += 1;
    }

    // ---------- Tỷ lệ theo trạng thái ----------
    const statusBreakdown = STATUSES.map((status) => ({
      status,
      count: byStatus[status],
      percentage: percent(byStatus[status], total),
    }));

    // ---------- Top 3 vị trí — O(m·k), KHÔNG sort ----------
    const positionEntries = [...byPosition.entries()];
    const topPositions = topK(positionEntries, 3, ([, count]) => count).map(
      ([position, count]) => ({ position, count, percentage: percent(count, total) }),
    );

    return Response.json({
      data: {
        total,
        statusBreakdown,
        topPositions,
        recentCount,
        distinctPositions: byPosition.size,
        truncated: total === MAX_ROWS,   // báo rõ nếu bị cắt bởi giới hạn
      },
    });
  }),
};
