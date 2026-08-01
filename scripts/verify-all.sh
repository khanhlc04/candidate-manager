#!/usr/bin/env bash
# Kiểm tra nhanh toàn bộ backend (Auth · Edge Functions · RPC · Storage · RLS).
#
# Dùng:
#   export SUPABASE_URL=https://<ref>.supabase.co
#   export SUPABASE_ANON_KEY=eyJhbGci...
#   ./scripts/verify-all.sh
#
# Cần sẵn hai tài khoản test hr.a@test.com và hr.b@test.com (mật khẩu Test123456!).
set -uo pipefail
cd "$(dirname "$0")/.."

: "${SUPABASE_URL:?Hãy export SUPABASE_URL}"
: "${SUPABASE_ANON_KEY:?Hãy export SUPABASE_ANON_KEY}"

pass=0; fail=0
check() { # check "<mô tả>" "<regex mong đợi>" "<thực tế>"
  if [[ "$3" =~ $2 ]]; then echo "  ✅ $1 → $3"; pass=$((pass+1))
  else echo "  ❌ $1 → $3 (mong khớp: $2)"; fail=$((fail+1)); fi
}
note() { echo "  ✅ $1"; pass=$((pass+1)); }
bad()  { echo "  ❌ $1"; fail=$((fail+1)); }

echo "→ Đăng nhập hai tài khoản test"
TOKEN_A=$(./scripts/get-token.sh hr.a@test.com 'Test123456!' 2>/dev/null)
TOKEN_B=$(./scripts/get-token.sh hr.b@test.com 'Test123456!' 2>/dev/null)
[ -n "${TOKEN_A:-}" ] && [ -n "${TOKEN_B:-}" ] && note "Lấy được token của cả A và B" \
  || { bad "Không lấy được token"; exit 1; }
UID_A=$(echo "$TOKEN_A" | cut -d. -f2 | python3 -c \
  "import sys,base64,json;s=sys.stdin.read().strip();print(json.loads(base64.urlsafe_b64decode(s+'='*(-len(s)%4)))['sub'])")
UID_B=$(echo "$TOKEN_B" | cut -d. -f2 | python3 -c \
  "import sys,base64,json;s=sys.stdin.read().strip();print(json.loads(base64.urlsafe_b64decode(s+'='*(-len(s)%4)))['sub'])")

echo
echo "→ Edge Function create-candidate"
FN="$SUPABASE_URL/functions/v1/create-candidate"
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$FN" \
  -H "Content-Type: application/json" -d '{"full_name":"X","applied_position":"Y"}')
check "Không token bị chặn" '^401$' "$code"

code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$FN" \
  -H "Authorization: Bearer khong-phai-token" -H "Content-Type: application/json" \
  -d '{"full_name":"X","applied_position":"Y"}')
check "Token rác bị chặn" '^401$' "$code"

code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$FN" \
  -H "Authorization: Bearer $TOKEN_A" -H "Content-Type: application/json" \
  -d '{"full_name":"A","applied_position":"Frontend Developer"}')
check "Tên quá ngắn bị chặn" '^400$' "$code"

code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$FN" \
  -H "Authorization: Bearer $TOKEN_A" -H "Content-Type: application/json" \
  -d "{\"full_name\":\"Trộm CV\",\"applied_position\":\"Dev\",\"resume_url\":\"$UID_B/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.pdf\"}")
check "Không gắn được CV của người khác" '^400$' "$code"

code=$(curl -s -o /dev/null -w "%{http_code}" -X GET "$FN" -H "Authorization: Bearer $TOKEN_A")
check "Sai method bị chặn" '^405$' "$code"

code=$(curl -s -o /dev/null -w "%{http_code}" -X OPTIONS "$FN" -H "Origin: http://localhost:5173" \
  -H "Access-Control-Request-Method: POST")
check "CORS preflight được xử lý" '^(200|204)$' "$code"

echo
echo "→ Edge Function analytics"
code=$(curl -s -o /dev/null -w "%{http_code}" "$SUPABASE_URL/functions/v1/analytics" \
  -H "Authorization: Bearer $TOKEN_A")
check "Gọi được với token" '^200$' "$code"
code=$(curl -s -o /dev/null -w "%{http_code}" "$SUPABASE_URL/functions/v1/analytics")
check "Không token bị chặn" '^401$' "$code"

tot() { curl -s "$SUPABASE_URL/functions/v1/analytics" -H "Authorization: Bearer $1" \
        | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['total'])"; }
TA_TOTAL=$(tot "$TOKEN_A"); TB_TOTAL=$(tot "$TOKEN_B")
[ "$TA_TOTAL" != "$TB_TOTAL" ] && note "RLS: total của A ($TA_TOTAL) ≠ của B ($TB_TOTAL)" \
                               || bad "A và B thấy cùng số liệu ($TA_TOTAL) — RLS hỏng"

echo
echo "→ Edge Function recommend"
REC='{"position":"Frontend Developer","required_skills":["react","typescript"]}'
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$SUPABASE_URL/functions/v1/recommend" \
  -H "Authorization: Bearer $TOKEN_A" -H "Content-Type: application/json" -d "$REC")
check "Gọi được với token" '^200$' "$code"
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$SUPABASE_URL/functions/v1/recommend" \
  -H "Authorization: Bearer $TOKEN_A" -H "Content-Type: application/json" -d '{"position":"A"}')
check "position quá ngắn bị chặn" '^400$' "$code"

sig() { curl -s -X POST "$SUPABASE_URL/functions/v1/recommend" -H "Authorization: Bearer $TOKEN_A" \
        -H "Content-Type: application/json" -d "$REC" \
        | python3 -c "import sys,json;print(','.join(f\"{r['id']}:{r['score']}\" for r in json.load(sys.stdin)['data']['recommendations']))"; }
[ "$(sig)" = "$(sig)" ] && note "Kết quả tất định giữa hai lần gọi" || bad "Kết quả đổi giữa hai lần gọi"

echo
echo "→ RPC search_candidates (ý #1 + #4)"
cnt() { curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/search_candidates" -H "apikey: $SUPABASE_ANON_KEY" \
        -H "Authorization: Bearer $1" -H "Content-Type: application/json" -d "$2" \
        | python3 -c "import sys,json;d=json.load(sys.stdin);print(len(d) if isinstance(d,list) else -1)"; }
[ "$(cnt "$TOKEN_A" '{"p_query":"frontend"}')" -ge 0 ] && note "Tìm full-text chạy được" || bad "RPC lỗi"
[ "$(cnt "$TOKEN_B" '{}')" = "0" ] && note "RLS: B không thấy dữ liệu của A qua RPC" \
                                  || bad "B thấy dữ liệu của A qua RPC"

echo
echo "→ Storage (bucket private, cô lập theo thư mục user)"
printf '%%PDF-1.4 verify\n' > /tmp/_verify_cv.pdf
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  "$SUPABASE_URL/storage/v1/object/resumes/$UID_A/_verify.pdf" \
  -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/pdf" --data-binary @/tmp/_verify_cv.pdf)
check "A upload vào thư mục của A" '^200$' "$code"

code=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  "$SUPABASE_URL/storage/v1/object/resumes/$UID_B/_hack.pdf" \
  -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/pdf" --data-binary @/tmp/_verify_cv.pdf)
check "A KHÔNG upload được vào thư mục của B" '^(400|403)$' "$code"

code=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  "$SUPABASE_URL/storage/v1/object/sign/resumes/$UID_A/_verify.pdf" \
  -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $TOKEN_B" \
  -H "Content-Type: application/json" -d '{"expiresIn":60}')
check "B KHÔNG xin được signed URL file của A" '^(400|403|404)$' "$code"

code=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  "$SUPABASE_URL/storage/v1/object/resumes/$UID_A/_verify.txt" \
  -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: text/plain" --data-binary @/tmp/_verify_cv.pdf)
check "File không phải PDF bị chặn" '^400$' "$code"

curl -s -o /dev/null -X DELETE "$SUPABASE_URL/storage/v1/object/resumes/$UID_A/_verify.pdf" \
  -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $TOKEN_A"
rm -f /tmp/_verify_cv.pdf

echo
echo "→ Data API tôn trọng RLS với anon"
code=$(curl -s -o /dev/null -w "%{http_code}" "$SUPABASE_URL/rest/v1/candidates?select=id" \
  -H "apikey: $SUPABASE_ANON_KEY")
if [ "$code" = "200" ]; then
  n=$(curl -s "$SUPABASE_URL/rest/v1/candidates?select=id" -H "apikey: $SUPABASE_ANON_KEY" \
      | python3 -c "import sys,json;d=json.load(sys.stdin);print(len(d) if isinstance(d,list) else -1)")
  [ "$n" = "0" ] && note "anon gọi được nhưng nhận 0 dòng" || bad "anon đọc được $n dòng"
else
  note "anon bị chặn ở tầng quyền (HTTP $code)"
fi

echo
echo "──────────────────────────────────────────"
echo "Kết quả: $pass đạt, $fail lỗi"
[ "$fail" -eq 0 ] || exit 1
