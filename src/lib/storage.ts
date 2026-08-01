import { supabase } from './supabase'

export const RESUME_BUCKET = 'resumes'
export const MAX_RESUME_BYTES = 5 * 1024 * 1024      // 5 MB — khớp với giới hạn bucket
export const ACCEPTED_MIME = ['application/pdf'] as const

/** Kết quả kiểm tra file trước khi upload. */
export type FileValidation = { ok: true } | { ok: false; reason: string }

/**
 * Kiểm tra phía client — chỉ để báo lỗi sớm cho người dùng.
 * Chốt chặn thật nằm ở bucket (file_size_limit, allowed_mime_types) và RLS.
 */
export function validateResumeFile(file: File): FileValidation {
  if (!ACCEPTED_MIME.includes(file.type as (typeof ACCEPTED_MIME)[number])) {
    return { ok: false, reason: `"${file.name}" không phải PDF (chỉ chấp nhận application/pdf).` }
  }
  if (file.size > MAX_RESUME_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1)
    return { ok: false, reason: `"${file.name}" nặng ${mb} MB, vượt giới hạn 5 MB.` }
  }
  if (file.size === 0) {
    return { ok: false, reason: `"${file.name}" là file rỗng.` }
  }
  return { ok: true }
}

/**
 * Sinh object path theo quy ước "<user_id>/<uuid>.pdf".
 *
 * Thư mục cấp 1 BẮT BUỘC là user_id — đó chính là thứ RLS policy kiểm tra.
 * Tên file dùng UUID ngẫu nhiên thay vì tên gốc để:
 *   - tránh trùng tên
 *   - tránh ký tự đặc biệt / dấu tiếng Việt gây lỗi đường dẫn
 *   - không lộ tên file gốc (có thể chứa thông tin cá nhân)
 */
export function buildResumePath(userId: string): string {
  return `${userId}/${crypto.randomUUID()}.pdf`
}

/** Upload một CV, trả về object path để lưu vào cột resume_url. */
export async function uploadResume(
  file: File,
  userId: string,
  signal?: AbortSignal,
): Promise<string> {
  const check = validateResumeFile(file)
  if (!check.ok) throw new Error(check.reason)

  const path = buildResumePath(userId)

  const { error } = await supabase.storage.from(RESUME_BUCKET).upload(path, file, {
    contentType: 'application/pdf',
    upsert: false,          // mỗi lần upload là một object mới → không cần quyền UPDATE
    ...(signal ? { signal } : {}),
  })

  if (error) throw new Error(`Upload "${file.name}" thất bại: ${error.message}`)
  return path
}

/**
 * Tạo link tải tạm thời cho một CV.
 *
 * Bucket là private nên không có URL vĩnh viễn. Signed URL mặc định sống 60 giây —
 * đủ để người dùng bấm mở, và không thể chia sẻ lại lâu dài.
 * Lệnh này đi qua RLS: xin link cho file của người khác sẽ bị từ chối.
 */
export async function getResumeSignedUrl(path: string, expiresInSeconds = 60): Promise<string> {
  const { data, error } = await supabase.storage
    .from(RESUME_BUCKET)
    .createSignedUrl(path, expiresInSeconds)

  if (error) throw new Error(`Không tạo được link tải: ${error.message}`)
  return data.signedUrl
}

/** Xoá file CV (dùng khi rollback lúc tạo hồ sơ thất bại, hoặc khi xoá hồ sơ). */
export async function removeResume(path: string): Promise<void> {
  const { error } = await supabase.storage.from(RESUME_BUCKET).remove([path])
  if (error) throw new Error(`Xoá file thất bại: ${error.message}`)
}
