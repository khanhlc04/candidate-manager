import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

interface AuthContextValue {
  session: Session | null
  user: User | null
  /** true = CHƯA BIẾT có session hay không. Đừng điều hướng khi cờ này còn bật. */
  loading: boolean
  signUp: (email: string, password: string) => Promise<void>
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

/** Chuyển thông báo lỗi kỹ thuật của Supabase sang tiếng Việt dễ hiểu. */
function toVietnameseError(message: string): string {
  const map: Record<string, string> = {
    'Invalid login credentials': 'Email hoặc mật khẩu không đúng.',
    'User already registered': 'Email này đã được đăng ký. Hãy đăng nhập.',
    'Email not confirmed': 'Tài khoản chưa xác nhận email.',
  }
  if (map[message]) return map[message]
  if (message.includes('Password should be at least')) return 'Mật khẩu phải có ít nhất 6 ký tự.'
  if (message.includes('Unable to validate email')) return 'Địa chỉ email không hợp lệ.'
  return message
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    // (1) Đọc session hiện có — chạy đúng một lần lúc app khởi động.
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return
        setSession(data.session)
      })
      .finally(() => {
        if (active) setLoading(false) // từ "chưa biết" sang "đã biết"
      })

    // (2) Lắng nghe thay đổi về sau: đăng nhập, đăng xuất, token được refresh,
    //     và cả khi user đăng xuất ở TAB KHÁC.
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setLoading(false)
    })

    return () => {
      active = false
      data.subscription.unsubscribe() // bắt buộc: tránh listener trùng ở StrictMode
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,

      async signUp(email, password) {
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) throw new Error(toVietnameseError(error.message))
      },

      async signIn(email, password) {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw new Error(toVietnameseError(error.message))
      },

      async signOut() {
        const { error } = await supabase.auth.signOut()
        if (error) throw new Error(toVietnameseError(error.message))
      },
    }),
    [session, loading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

/** Hook truy cập auth. Ném lỗi rõ ràng nếu quên bọc AuthProvider. */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth phải được dùng bên trong <AuthProvider>')
  return ctx
}
