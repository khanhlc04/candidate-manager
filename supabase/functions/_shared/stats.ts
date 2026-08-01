/**
 * Giữ K phần tử điểm cao nhất mà KHÔNG sort toàn bộ tập.
 *
 * Duy trì một mảng luôn được sắp giảm dần, độ dài tối đa k. Với mỗi phần tử:
 *   - nếu mảng đã đủ k và điểm không vượt phần tử nhỏ nhất → bỏ qua ngay O(1)
 *   - ngược lại chèn vào đúng vị trí, tối đa k-1 phép hoán đổi
 *
 * O(m·k) thời gian, O(k) bộ nhớ — tốt hơn sort O(m log m) khi k nhỏ và cố định.
 *
 * ỔN ĐỊNH: chỉ hoán đổi khi điểm LỚN HƠN HẲN, nên phần tử bằng điểm giữ nguyên
 * thứ tự đầu vào. Ý #6 dựa vào tính chất này để kết quả gợi ý tất định.
 */
export function topK<T>(items: readonly T[], k: number, scoreOf: (item: T) => number): T[] {
  if (k <= 0) return []
  const top: T[] = []

  for (const item of items) {
    const score = scoreOf(item)

    // Loại nhanh: đã đủ k và không hơn được phần tử yếu nhất.
    if (top.length === k && score <= scoreOf(top[k - 1])) continue

    if (top.length < k) top.push(item)
    else top[k - 1] = item

    // Đẩy phần tử vừa đặt lên đúng chỗ trong mảng đang sắp giảm dần.
    let i = top.length - 1
    while (i > 0 && scoreOf(top[i - 1]) < score) {
      const tmp = top[i - 1]
      top[i - 1] = top[i]
      top[i] = tmp
      i -= 1
    }
  }
  return top
}
