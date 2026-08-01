# Candidate Manager — Quản lý hồ sơ ứng viên

Ứng dụng web giúp nhân viên HR quản lý hồ sơ ứng viên: đăng ký/đăng nhập, thêm hồ sơ kèm CV,
theo dõi trạng thái tuyển dụng, và đồng bộ thời gian thực giữa nhiều phiên làm việc.

**Supabase Project URL:** `https://gzxjtsvlcbmpqjjimjbh.supabase.co`

**Supabase anon key:**

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd6eGp0c3ZsY2JtcHFqamltamJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU1NjcwNDYsImV4cCI6MjEwMTE0MzA0Nn0.9LaiJNjeL0RqTIEE7rAaRyln7dujCuexKzhcZtEMFGs
```

> `anon` key được thiết kế để lộ ra công khai (nó nằm sẵn trong bundle của mọi frontend Supabase).
> Thứ thật sự bảo vệ dữ liệu là RLS — role `anon` trong project này **không được cấp bất kỳ quyền nào**
> trên bảng `candidates`, xem phần [Bảo mật](#bảo-mật).

---

## Công nghệ

| Lớp | Công nghệ |
|-----|-----------|
| Frontend | React 19.2, TypeScript 6, Vite 8, Tailwind CSS v4, React Router 7 |
| Backend | Supabase Edge Functions (Deno, `@supabase/server` v1) |
| Database | PostgreSQL 17 (Supabase) với Row-Level Security |
| Storage | Supabase Storage (bucket private + signed URL) |
| Realtime | Supabase Realtime (`postgres_changes`) |
| Auth | Supabase Auth (email + mật khẩu) |

---

## Chạy thử tại máy

```bash
git clone https://github.com/khanhlc04/candidate-manager.git
cd candidate-manager
npm install

cp .env.example .env.local     # rồi điền VITE_SUPABASE_URL và VITE_SUPABASE_ANON_KEY
npm run dev                    # http://localhost:5173
```

Không cần thao tác nào khác ngoài việc điền hai biến môi trường.

**Tài khoản test có sẵn:**

| Email | Mật khẩu |
|---|---|
| `hr.a@test.com` | `Test123456!` |
| `hr.b@test.com` | `Test123456!` |

> Dùng **hai tài khoản trong hai cửa sổ khác nhau** để kiểm chứng RLS: mỗi tài khoản chỉ thấy
> hồ sơ của chính mình. Mở **hai tab cùng một tài khoản** để thấy Realtime đồng bộ.

### Dựng lại backend từ đầu

```bash
supabase link --project-ref <ref>
supabase db push                 # chạy toàn bộ migration: bảng, RLS, storage, search, phân trang
supabase functions deploy        # deploy cả 3 Edge Function
```

---

## Cấu trúc dự án

```
src/
├── lib/
│   ├── supabase.ts        client dùng chung (1 instance duy nhất)
│   ├── storage.ts         upload / signed URL / xoá CV, validate phía client
│   ├── concurrency.ts     worker pool + retry backoff        ← ý #3
│   └── matching.ts        tái xuất engine chấm điểm dùng chung ← ý #5
├── types/                 type sinh từ schema database + type nghiệp vụ
├── contexts/              AuthContext (session, đăng nhập/đăng xuất)
├── hooks/                 useCandidates, useRealtimeCandidates, useCandidateSearch
├── components/            component UI tái sử dụng
└── pages/                 AuthPage, DashboardPage

supabase/
├── migrations/
│   ├── 20260801083503_init_candidates.sql       bảng, ràng buộc, index, trigger, RLS, realtime
│   ├── 20260801084114_fix_candidates_grants.sql thu hồi quyền thừa của anon (xem ghi chú bên dưới)
│   ├── 20260801084844_storage_resumes.sql       bucket private + policy theo thư mục user
│   ├── 20260801103339_search_and_ranking.sql    tsvector + pg_trgm + search_candidates  ← ý #1
│   ├── 20260801105832_search_prefix_match.sql   thêm cửa khớp tiền tố cho từ khoá gõ dở ← ý #1
│   ├── 20260801110433_keyset_pagination.sql     phân trang cursor trên total ordering   ← ý #4
│   └── 20260801194820_search_unaccent.sql       bỏ dấu hai phía: "Nguyen" ra "Nguyễn"   ← ý #1
└── functions/
    ├── _shared/
    │   ├── validation.ts      kiểm tra dữ liệu tạo hồ sơ
    │   ├── stats.ts           thuật toán top-K            ← ý #2, #6
    │   ├── matching.ts        engine chấm điểm phù hợp     ← ý #5 (frontend dùng chung)
    │   ├── matching-topk.ts   ghép engine #5 với top-K     ← ý #6
    │   └── database.types.ts  type sinh từ schema
    ├── create-candidate/      tạo hồ sơ (bắt buộc theo đề)
    ├── analytics/             thống kê tổng hợp            ← ý #2
    └── recommend/             gợi ý top 3 ứng viên         ← ý #6
```

---

## Luồng dữ liệu khi thêm hồ sơ

```
React  ──① upload PDF──►  Storage (bucket private)
       ◄──② object path──
       ──③ functions.invoke + JWT──►  Edge Function create-candidate
                                       │ ④ validate
                                       │ ⑤ insert bằng JWT của user
                                       ▼
                                     PostgreSQL (RLS kiểm tra auth.uid())
                                       │ ⑥ WAL
                                       ▼
       ◄──⑦ event realtime────────  Realtime
```

Nếu bước ③–⑤ thất bại, file đã upload ở bước ① **bị xoá** để không để lại file mồ côi
(`useCandidates.createCandidate`). Khi xoá hồ sơ, file CV cũng bị dọn theo.

---

## Bảo mật

### Row-Level Security

RLS được bật trên `candidates` với **bốn policy tách riêng**, chỉ cấp cho role `authenticated`:

| Thao tác | `USING` | `WITH CHECK` |
|---|---|---|
| SELECT | `auth.uid() = user_id` | — |
| INSERT | — | `auth.uid() = user_id` |
| UPDATE | `auth.uid() = user_id` | `auth.uid() = user_id` |
| DELETE | `auth.uid() = user_id` | — |

`WITH CHECK` ở policy UPDATE là bắt buộc: thiếu nó, user có thể đổi `user_id` của bản ghi
sang tài khoản khác — "tặng" hồ sơ cho người lạ.

Điều kiện viết là `(select auth.uid())` thay vì `auth.uid()` — Postgres coi đây là InitPlan
nên chỉ gọi một lần thay vì gọi lại cho từng dòng.

Từ 30/05/2026 bảng mới trong `public` không còn tự động lộ ra Data API, nên migration `grant`
tường minh cho `authenticated`. Project này còn sót `ALTER DEFAULT PRIVILEGES` cũ tự cấp full
quyền cho **cả `anon`**, phát hiện lúc verify — migration `fix_candidates_grants` thu hồi lại.
Kết quả cuối: `authenticated` có đúng 4 quyền, `anon` **không có quyền nào**.

### Kiểm chứng RLS

Chạy bằng cách giả lập JWT của hai user trong cùng một giao dịch (rollback sau khi test):

| Kịch bản | Kết quả |
|---|---|
| A đọc danh sách (3 hồ sơ: 2 của A, 1 của B) | chỉ thấy 2 hồ sơ của A |
| B đọc danh sách | chỉ thấy 1 hồ sơ của B |
| A sửa hồ sơ của B | 0 dòng bị ảnh hưởng |
| A chèn hồ sơ với `user_id` của B | `new row violates row-level security policy` |
| A đổi `user_id` bản ghi của mình sang B | `new row violates row-level security policy` |
| Khách chưa đăng nhập (`anon`) | `permission denied for table candidates` |

### Storage

Bucket `resumes` được đặt **private**. Đề bài có nhắc "public URL", nhưng CV chứa dữ liệu cá nhân
(họ tên, số điện thoại, địa chỉ, lịch sử làm việc) nên URL công khai vĩnh viễn là rủi ro. Thay vào đó:

- `resume_url` lưu **object path** `<user_id>/<uuid>.pdf`, không phải URL
- Link tải sinh bằng `createSignedUrl(path, 60)` — hết hạn sau 60 giây
- Policy trên `storage.objects` kiểm tra `storage.foldername(name)[1] = auth.uid()`
- Chốt chặn phía server: 5 MB, chỉ nhận `application/pdf` (cấu hình ngay trên bucket, không thể
  vượt qua kể cả khi gọi thẳng API)
- Tên file dùng UUID ngẫu nhiên thay vì tên gốc: tránh trùng, tránh ký tự tiếng Việt, không lộ
  tên file gốc

Muốn chuyển sang bucket public: đổi `public = false` → `true` trong `..._storage_resumes.sql`.

| Kịch bản kiểm thử (HTTP thật) | Kết quả |
|---|---|
| A upload vào thư mục của A | `200` |
| A upload vào thư mục của B | `400` (RLS chặn) |
| B xin signed URL cho file của A | `400` |
| A xin signed URL cho file của mình | `200`, tải được |
| Signed URL sau 60 giây | `400 InvalidJWT — "exp" claim timestamp check failed` |
| Khách tải trực tiếp qua `/object/public/...` | `400` |
| Upload `text/plain` | `400 mime type text/plain is not supported` |
| Upload PDF 6 MB | `400` (vượt `file_size_limit`) |

### Edge Functions

- Dùng `withSupabase({ auth: 'user' })` → JWT được xác thực **trước khi** handler chạy
- `user_id` lấy từ `ctx.userClaims.id`, **bỏ qua hoàn toàn** giá trị client gửi trong body
- Client bên trong function mang JWT của người gọi — **cố ý không dùng `service_role`**,
  để RLS vẫn là hàng rào cuối cùng (defense in depth)
- Validate: độ dài tên/vị trí, enum trạng thái, chuẩn hoá `skills` (lowercase + khử trùng lặp),
  định dạng object path, và path **phải thuộc thư mục của chính người gọi**

| Kịch bản (`create-candidate`) | Kết quả |
|---|---|
| Không token / token rác | `401` |
| Sai method (GET) | `405` |
| Body không phải JSON | `400` |
| `full_name` 1 ký tự | `400` + `details: ["full_name phải có từ 2 đến 120 ký tự."]` |
| `status: "Superstar"` | `400` + liệt kê status hợp lệ |
| Gửi kèm `user_id` của B | `201` nhưng bản ghi thuộc về **A** — mạo danh bất thành |
| `resume_url` trỏ vào thư mục của B | `400` — "resume_url phải nằm trong thư mục của chính bạn" |
| CORS preflight | `204` |

---

## API

| Method | Endpoint | Auth | Mô tả |
|---|---|---|---|
| POST | `/functions/v1/create-candidate` | Bearer JWT | Tạo hồ sơ. `201` / `400` / `401` / `403` / `405` |
| GET·POST | `/functions/v1/analytics` | Bearer JWT | Thống kê tổng hợp (ý #2) |
| POST | `/functions/v1/recommend` | Bearer JWT | Gợi ý top-K ứng viên cho một vị trí (ý #6) |
| RPC | `search_candidates(...)` | Bearer JWT | Tìm kiếm + lọc 4 tiêu chí + phân trang cursor (ý #1, #4) |

<details>
<summary>Ví dụ gọi bằng curl</summary>

```bash
TOKEN=$(./scripts/get-token.sh hr.a@test.com 'Test123456!')

# Tạo hồ sơ
curl -X POST "$SUPABASE_URL/functions/v1/create-candidate" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"full_name":"Nguyễn Văn A","applied_position":"Frontend Developer","skills":["react","typescript"]}'

# Thống kê
curl "$SUPABASE_URL/functions/v1/analytics" -H "Authorization: Bearer $TOKEN"

# Gợi ý
curl -X POST "$SUPABASE_URL/functions/v1/recommend" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"position":"Frontend Developer","required_skills":["react","typescript"],"limit":3}'
```
</details>

---

## Phần 3 — Thuật toán

Đề yêu cầu tối thiểu 1 ý; bài này triển khai **đủ cả 6**.

| Ý | Nội dung | Nơi cài đặt | Chạy ở |
|---|----------|-------------|--------|
| #1 | Lọc đa tiêu chí + full-text + tìm gần đúng | `search_and_ranking.sql`, `search_prefix_match.sql` | SQL (RPC) |
| #2 | Edge Function `/analytics` | `supabase/functions/analytics/` | Edge Function |
| #3 | Upload song song có giới hạn | `src/lib/concurrency.ts` | Frontend |
| #4 | Phân trang cursor | `keyset_pagination.sql` (cùng `search_candidates`) | SQL (RPC) |
| #5 | Xếp hạng theo mức độ phù hợp | `supabase/functions/_shared/matching.ts` | Dùng chung |
| #6 | Edge Function `/recommend` | `supabase/functions/recommend/` | Edge Function |

### Ý #3 — Upload song song có giới hạn concurrency

`src/lib/concurrency.ts`. Tạo đúng N worker cùng rút việc từ **một con trỏ dùng chung**; con trỏ
`next++` an toàn không cần khoá vì JavaScript đơn luồng (không có `await` giữa lúc đọc và tăng).
Khác cách chia lô, worker nào rảnh là nhận việc mới ngay — không có rào chắn giữa các lô.

Trả kết quả từng phần theo kiểu `allSettled` **giữ đúng thứ tự đầu vào**, nên một file hỏng không
làm hỏng cả lô. Có `withRetry` với backoff luỹ thừa + **jitter** để tránh thundering herd (5 file
cùng hỏng mà cùng thử lại sau đúng 400 ms thì lại đâm vào nhau lần nữa).

**Độ phức tạp:** thời gian ≈ ⌈n/limit⌉ × thời gian mỗi file; số kết nối đồng thời luôn ≤ limit.
Đo thực tế trên trình duyệt: 6 file với `limit = 3` → **đỉnh chồng lấn đúng 3 request Storage**,
hoàn tất 6/6 trong 2.2 s.

### Ý #2 — Edge Function `/analytics`

`supabase/functions/analytics/`. Gom tổng số, tỷ lệ 4 trạng thái, top 3 vị trí và số hồ sơ trong
7 ngày trong **một lần duyệt O(n)** thay vì duyệt bốn lần. Top-3 dùng thuật toán **top-K**
duy trì mảng có thứ tự độ dài k — **O(m·k)** thay vì sort **O(m log m)**.

Chỉ `select` 3 cột cần dùng. Có `MAX_ROWS` và cờ `truncated` để minh bạch giới hạn.
Hàm `percent()` chặn chia cho 0 → tài khoản trống trả `0`, không bao giờ ra `NaN`.

### Ý #1 — Lọc đa tiêu chí + tìm kiếm full-text + gần đúng

Hàm `search_candidates` lọc đồng thời **bốn tiêu chí** đề nêu (tên, vị trí, trạng thái, khoảng ngày)
bằng mẫu `(p_x is null or <điều kiện>)` — một hàm duy nhất phục vụ cả 16 tổ hợp, không cần sinh SQL
động (vốn dễ dính SQL injection).

Cột `search_vector` được duy trì bằng **trigger** chứ không phải generated column, vì
`array_to_string` được Postgres đánh dấu `STABLE` chứ không `IMMUTABLE`. Dùng cấu hình `'simple'`
thay vì `'english'` vì stemming tiếng Anh sẽ làm hỏng tên tiếng Việt.

Từ khoá vào được kết quả qua **ba cửa**, vì mỗi cửa có điểm mù riêng:

1. **FTS** (`websearch_to_tsquery`) — khớp nguyên token
2. **Trigram** (`%` của `pg_trgm`) — chịu được gõ sai chính tả
3. **Khớp tiền tố** (`ilike 'abc%'`, neo trái nên vẫn dùng được index GIN) — cho từ khoá gõ dở
   chừng, thứ mà cả FTS lẫn trigram đều trượt

Cả ba cửa đều chạy trên dạng **đã bỏ dấu**, vì cả ba đều phân biệt dấu mà bàn phím mặc định của
người dùng thì thường không gõ dấu. Extension `unaccent` chuẩn hoá **cả hai phía** — dữ liệu (khi
trigger dựng `search_vector`) lẫn từ khoá (khi vào truy vấn) — nên phép so sánh vẫn đối xứng: gõ
có dấu hay không dấu đều ra cùng kết quả.

`unaccent()` được Postgres đánh dấu `STABLE`, mà index biểu thức thì bắt buộc `IMMUTABLE`, nên có
một hàm bọc `f_unaccent()` khai báo `IMMUTABLE` có chủ ý (gọi dạng 2 tham số với tên từ điển ghi
rõ schema, nên kết quả không còn phụ thuộc `search_path`). Hai index trigram GIN chuyển sang đặt
trên `f_unaccent(full_name)` / `f_unaccent(applied_position)` để planner vẫn dùng được — đã xác
nhận bằng `explain`: `Bitmap Index Scan on candidates_full_name_unaccent_trgm_idx`.

Điểm liên quan: `0.5 × ts_rank + 0.3 × similarity + 0.2 × khớp tiền tố`, làm tròn 6 chữ số.

Kết quả thực tế: `"frontend"` → 3 hồ sơ đúng, xếp theo điểm; `"Frontened"` (gõ sai) → vẫn ra
đủ 3 hồ sơ đó; `"Nguy"` (gõ dở) → ra `Nguyễn Văn An`; `"Nguyen"` (không dấu) → ra `Nguyễn Văn An`;
`"Do"` → ra `Đỗ Quốc Bảo`, `Đỗ Quang Huy`, `đỗ việt hoàng`; `"Le Thi"` → ra `Lê Thị Thống Kê`.

### Ý #4 — Phân trang cursor

Cùng hàm `search_candidates`, thêm 3 tham số con trỏ. `OFFSET` có hai vấn đề: **lặp/sót dòng**
khi dữ liệu đổi giữa hai lần lật trang (mà app này bật Realtime nên chuyện đó xảy ra thật), và
**chậm dần** vì phải đọc rồi vứt bỏ n dòng — O(offset + limit) thay vì O(log n + limit).

Keyset pagination so sánh bộ giá trị `(score, created_at, id) < (cursor…)`. `id` là khoá chính nên
bộ ba là **total ordering** → không bao giờ lặp, không bao giờ sót. `score` được làm tròn 6 chữ số
vì nó đi một vòng Postgres → JSON → JavaScript → JSON → Postgres rồi quay lại làm con trỏ; không
làm tròn thì sai số dấu phẩy động làm trượt phép so sánh và **mất dòng**.

Đánh đổi: không nhảy được tới trang bất kỳ — giao diện "Tải thêm" của bài này không cần điều đó.

Kiểm chứng: lấy trang 1 (3 dòng) → **chèn một hồ sơ mới** → lấy trang 2 bằng con trỏ cũ.
Kết quả: không lặp dòng nào, và 6 dòng lấy được đúng bằng 6 dòng đầu của danh sách gốc.

### Ý #5 — Xếp hạng theo mức độ phù hợp (matching score)

`supabase/functions/_shared/matching.ts` — engine thuần TypeScript, **không import gì**, nên dùng
chung được ở cả Edge Function (Deno) lẫn frontend (Vite): một nguồn sự thật duy nhất, không có
hai bản copy lệch nhau.

```
score = 45% bao phủ kỹ năng + 25% Dice tên vị trí
      + 15% giai đoạn tuyển dụng + 15% phân rã mũ theo độ mới      → thang 0–100
```

Bốn quyết định đáng nói:

- **Cố ý không dùng Jaccard làm điểm chính.** Jaccard chia cho **hợp** nên ứng viên đáp ứng đủ JD
  mà còn biết thêm 4 kỹ năng khác bị tụt từ `1.00` xuống `0.33` — vô lý với bài toán tuyển dụng.
  Thay vào đó là **bao phủ bất đối xứng** theo phía yêu cầu:
  `(2·|bắt_buộc ∩ cand| + |ưu_tiên ∩ cand|) / (2·|bắt_buộc| + |ưu_tiên|)` — kỹ năng bắt buộc nặng
  gấp đôi ưu tiên. Jaccard vẫn được trả về trong `breakdown` như chỉ số phụ để đối chiếu.
- **Chuẩn hoá lại trọng số** khi JD không nêu kỹ năng: bỏ thành phần đó khỏi công thức rồi chia cho
  tổng trọng số **còn lại**, thay vì để mọi ứng viên mất oan 45% điểm. Nhờ vậy điểm luôn thuộc
  `[0,1]` và so sánh được giữa các JD khác nhau.
- **`Rejected` là loại thẳng, không phải bị trừ điểm.** Vì điểm là tổng có trọng số, một ứng viên
  đã loại mà hồ sơ đẹp vẫn được 85/100 nếu chỉ mất 15% của thành phần "giai đoạn". Trọng số 0 được
  nhân như một cái cổng — chính sách vẫn nằm gọn trong `PIPELINE_WEIGHT`.
- **Sắp xếp tất định** theo `(score, created_at, id)` — total ordering, nên chạy lại luôn cho cùng
  thứ tự, không phụ thuộc engine sort của JS có ổn định hay không.

Kết quả kèm `breakdown`, `matched_required`, `missing_required` để **giải trình được** vì sao người
này xếp trên người kia. **Độ phức tạp:** O(n·k) chấm điểm + O(n log n) sắp xếp.

Bảng xếp hạng chạy **tại client** — đổi JD là bảng đổi ngay, không tốn một request nào.

### Ý #6 — Edge Function `/recommend`

`supabase/functions/recommend/`. **Dùng lại engine của ý #5** thay vì viết lại thuật toán — #5 là bộ
máy chấm điểm, #6 là endpoint đưa nó lên server để quét **toàn bộ** kho hồ sơ (frontend chỉ giữ
trang đang xem). Chọn top-K **O(n·K)** thay vì sort toàn bộ O(n log n).

Đầu vào được **sắp tất định trước** khi chạy top-K, vì Postgres không cam kết thứ tự khi không có
`order by`. `topK` chỉ đẩy phần tử lên khi điểm **lớn hơn hẳn** nên phần tử bằng điểm giữ nguyên
thứ tự đầu vào — kết hợp hai điều đó, kết quả không đổi giữa các lần gọi kể cả khi người thứ 3 và
thứ 4 bằng điểm nhau. Gọi 5 lần liên tiếp cho **5 kết quả giống hệt**, và trùng khớp với bảng xếp
hạng phía client trên cùng bộ dữ liệu.

---

## Realtime

Bảng `candidates` được thêm vào publication `supabase_realtime`, `replica identity full`.
RLS **tự động** áp dụng cho từng subscriber nên user không nhận được thay đổi trên dữ liệu người khác.

Danh sách được cập nhật từ hai nguồn — phản hồi của Edge Function (optimistic) và event Realtime.
Cả hai đi qua cùng một hàm hợp nhất theo `id`, nên thao tác là **idempotent**: không tạo dòng trùng
dù event tới theo thứ tự nào. Channel được đặt tên theo `userId` để đổi tài khoản là tạo channel mới
thay vì dùng lại channel mang token cũ; effect có cleanup `removeChannel` để StrictMode không để lại
hai subscription xử lý mỗi event hai lần.

Lưu ý: khi RLS bật, `payload.old` của sự kiện DELETE chỉ chứa khoá chính — đủ để gỡ dòng khỏi danh sách.

Đã kiểm chứng với hai tab: thêm ở tab 1 → tab 2 tự hiện, tab 1 **không nhân đôi**; đổi trạng thái và
xoá cũng đồng bộ; `INSERT` chạy thẳng trong SQL cũng hiện ngay trên cả hai tab.

---

## Quyết định thiết kế & đánh đổi

| Quyết định | Lý do |
|---|---|
| Bucket private + signed URL 60 s | CV là dữ liệu cá nhân; URL public vĩnh viễn là rủi ro |
| Edge Function dùng JWT user, không dùng `service_role` | Giữ RLS làm hàng rào cuối; defense in depth |
| Cập nhật trạng thái / xoá gọi thẳng Data API | Đề chỉ bắt buộc Edge Function cho thao tác *thêm*; gọi thẳng cũng cho thấy RLS đang bảo vệ |
| Trigger thay cho generated column ở `search_vector` | `array_to_string` là `STABLE`, không dùng được cho generated column |
| Cấu hình FTS `'simple'` thay vì `'english'` | Stemming tiếng Anh làm hỏng tên tiếng Việt |
| Bọc `unaccent()` thành `f_unaccent()` `IMMUTABLE` | Bản gốc là `STABLE` nên không dùng được trong index biểu thức; đổi lại phải `REINDEX` + nạp lại `search_vector` nếu nâng cấp Postgres major có đổi `unaccent.rules` |
| Bỏ dấu cả ô lọc tên/vị trí, không chỉ ô từ khoá | Nếu chỉ một ô bỏ dấu thì cùng chuỗi `Nguyen` cho hai kết quả khác nhau tuỳ gõ vào ô nào — bẫy khó hiểu hơn là không hỗ trợ hẳn |
| Tính thống kê trong Edge Function thay vì `GROUP BY` | Đề yêu cầu rõ là Edge Function; có `MAX_ROWS` + cờ `truncated` để minh bạch giới hạn |
| Bao phủ bất đối xứng thay vì Jaccard | Jaccard phạt oan ứng viên nhiều kỹ năng (xem ý #5) |
| Keyset thay vì `OFFSET` | Realtime bật ⇒ dữ liệu trôi giữa hai lần lật trang |
| Tắt xác nhận email | Để tiện chấm bài. Production **phải bật lại** |

## Hạn chế đã biết

- `/analytics` và `/recommend` tải tối đa `MAX_ROWS` bản ghi về function (10 000 và 5 000). Với quy mô
  lớn hơn nên chuyển sang hàm SQL tổng hợp phía database; hiện đã có cờ `truncated` để không im lặng.
- Chưa có test tự động trong repo. Toàn bộ kiểm chứng nêu trong README được chạy thủ công qua
  SQL, `curl` và trình duyệt.
- Xác nhận email đang tắt (xem bảng trên).
- Supabase Advisors còn 2 cảnh báo mức **WARN** (không có ERROR): `public.rls_auto_enable()` là hàm
  `SECURITY DEFINER` **do nền tảng Supabase tạo sẵn**, không thuộc repo này (nó trả về `event_trigger`
  nên thực tế không gọi được qua RPC); và "leaked password protection" chưa bật — bật được trong
  Dashboard → Authentication.
