---
status: draft
title: Ideal Specification - Harness Framework
description: Ý tưởng về một khung làm việc ép mọi LLM đi theo đúng vòng đời phát triển phần mềm (SDLC).
---

# Harness Framework - Ideal Specification

> **Ý tưởng cốt lõi:** Lấy cảm hứng từ Vòng đời phát triển phần mềm (SDLC - Software Development Life Cycle), xây dựng một khung làm việc (framework) bằng Markdown để ép buộc mọi LLM/AI Agent khi thực hiện yêu cầu phải đi theo đúng vòng đời chuẩn chỉnh.
>
> *Tham khảo thêm chi tiết ý tưởng tại:
> - SDLC: phase gates, role separation, artifacts, testing, release, and maintenance.
> - [GStack](https://github.com/garrytan/gstack): root-level agent instructions, specialized review perspectives, QA/review/ship mindset.
> - [GSD Core](https://github.com/open-gsd/gsd-core): context files, roadmap/phase planning, verification loops, and context rot mitigation.
>  - [Superpowers](https://github.com/obra/superpowers): design before execution, systematic debugging, test-first pressure, and reviewer-style gates.
> - [Repository Harness](https://github.com/hoangnb24/repository-harness): repository-local agent instructions, feature intake, validation expectations, and durable > decisions.

---

## I. Các Vai Trò Chính (Key Roles)

Tùy vào quy mô dự án và mô hình làm việc (Agile, Waterfall...), các vai trò có thể được gộp lại hoặc chia nhỏ hơn, nhưng cơ bản bao gồm:

*   **PO (Product Owner) / BA (Business Analyst):** Người đại diện cho khách hàng/nghiệp vụ, chịu trách nhiệm thu thập và phân tích yêu cầu.
*   **PM (Project Manager) / Scrum Master:** Quản lý dự án, điều phối tài nguyên, theo dõi tiến độ và giải quyết các trở ngại.
*   **SA (Software Architect) / Tech Lead:** Thiết kế kiến trúc hệ thống, chọn công nghệ và định hướng kỹ thuật.
*   **UI/UX Designer:** Thiết kế giao diện (UI) và trải nghiệm người dùng (UX).
*   **Developer / Software Engineer (Dev):** Lập trình viên (Frontend, Backend, Mobile), người trực tiếp viết code.
*   **QA/QC (Quality Assurance / Quality Control) / Tester:** Đảm bảo chất lượng phần mềm, tìm kiếm lỗi (bug) và xác nhận phần mềm hoạt động đúng yêu cầu.
*   **DevOps / System Administrator:** Quản lý hạ tầng, máy chủ, tự động hóa quy trình triển khai (CI/CD).

### Sơ đồ Vòng đời & Các Vai trò Tham gia (SDLC Flow Diagram)

```text
                     +-----------------------------------+
                     |    YÊU CẦU ĐẦU VÀO (User Request) |
                     +-----------------------------------+
                                       |
                                       v
+--------------------------------------------------------------------------+
| 1. PLANNING + ANALYZE + DESIGN                                           |
|    - Roles: PO, BA, PM, SA/Tech Lead, UI/UX Designer                     |
|    - Hoạt động: Phân tích nghiệp vụ, lập kế hoạch, thiết kế hệ thống & UI|
|    - Tài liệu: BRD, SRS, SDD, ERD, Wireframes / Figma                    |
+--------------------------------------------------------------------------+
                                       |
                                       v
+--------------------------------------------------------------------------+
| 2. DEVELOPMENT & TESTING (Dev + Test)                                    |
|    - Roles: Developer (FE/BE/Mobile), QA/QC                              |
|    - Hoạt động: Viết mã nguồn, viết Unit Test, lập kịch bản kiểm thử     |
|    - Tài liệu: Source Code, API Doc (Swagger), Test Cases                |
+--------------------------------------------------------------------------+
                                       |
                                       v
+--------------------------------------------------------------------------+
| 3. VERIFICATION (Verify & UAT)                                           |
|    - Roles: QA/QC, Developer, PO                                         |
|    - Hoạt động: Thực thi test, ghi nhận lỗi, sửa lỗi, nghiệm thu UAT     |
|    - Tài liệu: Bug Reports, Test Execution Report, UAT Sign-off          |
+--------------------------------------------------------------------------+
                                       |
                     [Kiểm thử thất bại / Có lỗi]
                                       +------------------+
                                       |                  |
                                       v (Fix & Retest)   |
                                 +-----------+            |
                                 | Lặp lại   | <----------+
                                 +-----------+
                                       |
                     [Kiểm thử thành công / Đạt UAT]
                                       |
                                       v
+--------------------------------------------------------------------------+
| 4. RELEASE & DEPLOY                                                      |
|    - Roles: Developer, DevOps                                            |
|    - Hoạt động: Cấu hình server, deploy production, chạy CI/CD pipeline  |
|    - Tài liệu: Release Notes, User Manual, Deployment Document           |
+--------------------------------------------------------------------------+
                                       |
                                       v
+--------------------------------------------------------------------------+
| 5. MAINTENANCE (Bảo trì)                                                 |
|    - Roles: DevOps, Developer, PO, PM                                    |
|    - Hoạt động: Giám sát hệ thống, sửa lỗi Production, lên kế hoạch v2   |
|    - Tài liệu: Incident Reports, Maintenance Logs                        |
+--------------------------------------------------------------------------+
```

---

## II. Các Giai Đoạn, Công Việc & Tài Liệu Sinh Ra (SDLC Phases)

Quá trình phát triển đi qua 6 giai đoạn cốt lõi được cấu trúc chi tiết dưới đây:

### 1. Thu thập & Phân tích Yêu cầu (Requirement Analysis)
*   **Mục tiêu:** Trả lời câu hỏi *"Phần mềm cần phải làm gì?"*
*   **Chi tiết thực thi:**
    | Vai trò | Công việc chi tiết |
    | :--- | :--- |
    | **BA / PO** | Họp với stakeholders, lấy yêu cầu, phân tích tính khả thi, mô hình hóa luồng nghiệp vụ. |
    | **PM** | Đánh giá rủi ro, dự toán thời gian/chi phí, lập kế hoạch. |
    | **Tech Lead / Arch** | Tư vấn ban đầu về khả năng đáp ứng kỹ thuật. |
*   **Tài liệu sinh ra (Artifacts):**
    *   `BRD (Business Requirement Document)`
    *   `SRS (Software Requirement Specification)`
    *   `Project Plan` (Kế hoạch dự án)

### 2. Thiết kế (Design)
*   **Mục tiêu:** Trả lời câu hỏi *"Phần mềm sẽ được xây dựng như thế nào?"*
*   **Chi tiết thực thi:**
    | Vai trò | Công việc chi tiết |
    | :--- | :--- |
    | **Tech Lead / Arch** | Thiết kế kiến trúc tổng thể, database schema, luồng hệ thống. |
    | **UI/UX Designer** | Vẽ wireframe, mockups, làm bản mẫu tương tác (prototype). |
    | **QA/QC** | Đọc hiểu tài liệu SRS để chuẩn bị tư duy kiểm thử. |
*   **Tài liệu sinh ra (Artifacts):**
    *   `SDD (Software Design Document)`
    *   `Database Schema / ERD`
    *   `Figma Wireframes / Mockups / UI/UX Guidelines`

### 3. Lập trình / Thực thi (Implementation / Coding)
*   **Mục tiêu:** Biến các bản thiết kế thành mã nguồn thực tế.
*   **Chi tiết thực thi:**
    | Vai trò | Công việc chi tiết |
    | :--- | :--- |
    | **Developer** | Lập trình các task FE/BE/Mobile, viết và chạy Unit Test. |
    | **Tech Lead** | Đánh giá mã nguồn (Code Review), đảm bảo chuẩn kỹ thuật. |
    | **QA/QC** | Chuẩn bị kịch bản kiểm thử (Test Cases) dựa trên SRS & SDD. |
    | **PM** | Theo dõi tiến độ hàng ngày (Daily Stand-up). |
*   **Tài liệu sinh ra (Artifacts):**
    *   `Source Code` (Mã nguồn)
    *   `API Documentation` (Swagger/Postman)
    *   `Test Plan & Test Cases`

### 4. Kiểm thử (Testing)
*   **Mục tiêu:** Đảm bảo phần mềm không có lỗi (bug) và đúng yêu cầu.
*   **Chi tiết thực thi:**
    | Vai trò | Công việc chi tiết |
    | :--- | :--- |
    | **QA/QC** | Thực thi Test Cases, log bugs (Jira/Bugzilla), retest bug. |
    | **Developer** | Tiếp nhận báo cáo lỗi từ QA, sửa lỗi (bug-fixing), cập nhật. |
    | **BA / PO** | Thực hiện UAT (User Acceptance Testing) để chốt tính năng. |
*   **Tài liệu sinh ra (Artifacts):**
    *   `Bug Reports / Issue Logs` (Báo cáo lỗi)
    *   `Test Execution Report` (Báo cáo kết quả kiểm thử)
    *   `UAT Sign-off` (Biên bản nghiệm thu khách hàng)

### 5. Triển khai (Deployment / Release)
*   **Mục tiêu:** Đưa phần mềm lên môi trường thực tế (Production).
*   **Chi tiết thực thi:**
    | Vai trò | Công việc chi tiết |
    | :--- | :--- |
    | **DevOps / SysAdmin** | Cấu hình máy chủ, CI/CD pipeline, đưa code lên môi trường production. |
    | **Developer** | Hỗ trợ xử lý lỗi nóng (Hotfix) phát sinh ngay khi release. |
    | **PM** | Gửi thông báo phát hành đến khách hàng/các bên liên quan. |
*   **Tài liệu sinh ra (Artifacts):**
    *   `Release Notes` (Mô tả thay đổi/lỗi đã vá)
    *   `User Manual / User Guide` (Hướng dẫn sử dụng)
    *   `Deployment Document` (Tài liệu triển khai/cấu hình)

### 6. Bảo trì (Maintenance)
*   **Mục tiêu:** Duy trì hoạt động ổn định và ghi nhận phản hồi để cải tiến.
*   **Chi tiết thực thi:**
    | Vai trò | Công việc chi tiết |
    | :--- | :--- |
    | **DevOps / SysAdmin** | Giám sát hệ thống (Monitor), quản lý tải, sao lưu dữ liệu. |
    | **Developer** | Sửa lỗi phát sinh trên production (Hotfix), nâng cấp thư viện. |
    | **PO / PM** | Thu thập phản hồi người dùng, lên kế hoạch cho phiên bản sau. |
*   **Tài liệu sinh ra (Artifacts):**
    *   `Incident Reports` (Báo cáo sự cố hệ thống)
    *   `Maintenance Logs` (Nhật ký bảo trì)

---

## III. Cơ Chế Hoạt Động & Tổ Chức Thư Mục

Để đảm bảo LLM tuân thủ đúng quy trình SDLC, cấu trúc thư mục `docs/` được tổ chức chặt chẽ tương ứng với từng giai đoạn và vai trò chịu trách nhiệm:

```text
docs/
├── planning/                      # [Phase 1: Phân tích & Lập kế hoạch]
│   ├── BACKLOG.md                 - Quản lý danh sách công việc, phân chia Phase (PO, BA, PM)
│   └── bugs/                      - Thư mục quản lý báo cáo lỗi chi tiết (QA, Dev)
├── product/                       # [Phase 1: Đặc tả Sản phẩm]
│   └── (Đặc tả chi tiết)          - Nơi lưu trữ các tài liệu BRD, SRS chi tiết cho từng sản phẩm (PO, BA)
├── decisions/                     # [Phase 1 & 2: Thiết kế & Quyết định Kiến trúc]
│   └── (ADRs)                     - Nhật ký lưu trữ các quyết định thiết kế kiến trúc hệ thống (SA, Tech Lead)
├── conventions/                   # [Phase 2 & 3: Quy chuẩn Phát triển]
│   └── (Quy chuẩn)                - Quy chuẩn viết code, đặt tên, cấu trúc dự án (Tech Lead)
├── development/                   # [Phase 3: Thực thi - Hướng dẫn Dev]
│   └── (Hướng dẫn kỹ thuật)       - Hướng dẫn thiết lập môi trường lập trình, tài liệu API (Developer)
├── templates/                     # [Mẫu tài liệu chuẩn cho dự án]
│   ├── SPEC.md                    - Mẫu đặc tả yêu cầu (PRS + SRS)
│   ├── ERD.md                     - Mẫu thiết kế sơ đồ cơ sở dữ liệu
│   ├── ARCHITECTURE.md            - Mẫu tài liệu kiến trúc tổng thể
│   ├── API.md                     - Mẫu đặc tả API endpoints
│   ├── DETAIL_DESIGN.md           - Mẫu tài liệu thiết kế chi tiết tính năng
│   ├── TEST_VERIFICATION.md       - Mẫu kịch bản kiểm thử & nghiệm thu (Test Cases/UAT)
│   └── TICKET.md                  - Mẫu định dạng task/ticket để giao việc (PM/Scrum Master)
├── deployments/                   # [Phase 5: Triển khai & Vận hành]
│   └── (Cấu hình triển khai)      - Hướng dẫn deploy, cấu hình CI/CD, cấu hình server (DevOps, SysAdmin)
└── changelogs/                    # [Phase 5 & 6: Phát hành & Bảo trì]
    └── (Lịch sử thay đổi)         - Ghi nhận nhật ký thay đổi qua từng phiên bản (PM, Dev)
```

### Triết lý Cốt lõi của Framework:
1.  **Duy trì Context chung:** Chia sẻ trạng thái dự án liên tục giữa người và AI để đảm bảo hiểu đúng và đủ.
2.  **Giảm Context Rot (Suy thoái ngữ cảnh):** Chỉ tải bối cảnh cần thiết cho tác vụ hiện tại, giữ kích thước context window ở mức tối ưu.
3.  **Tài liệu luôn tự cập nhật (Living Docs):** Tài liệu phát triển song song với code chứ không bị bỏ rơi.
4.  **Cổng điều phối Agent:** File `AGENTS.md` tại thư mục gốc đóng vai trò gateway điều phối agents tuân theo các ràng buộc.

---

## IV. Quy Trình Thực Thi Cho Agent

### 1. Khởi Tạo Dự Án (Project Initialization)
*   **Greenfield (Dự án mới):** Bắt đầu với một file `spec.md` trống hoặc theo template, sau đó sinh ra các tài liệu kiến trúc quan trọng (`ARCHITECTURE.md`, `SPEC.md`, v.v.).
*   **Brownfield (Dự án có sẵn):** Ép Agent kiểm tra cấu trúc thư mục và tài liệu hiện tại trước khi thực hiện bất kỳ công việc nào. Nếu thiếu tài liệu master, Agent sẽ tự tổng hợp và dựng khung.

### 2. Thực Thi Công Việc & Sửa Lỗi (Implementation & Bug-fixing)

Dù là viết tính năng hay sửa bug, quy trình đều yêu cầu sự phối hợp chặt chẽ giữa vai trò Dev và QA thông qua các bước:

*   **Với Ticket mới:** Dev tạo một file `DETAIL_DESIGN.md` (tài liệu thiết kế chi tiết) cho ticket đó. Sau khi code xong, bắt buộc phải viết bài kiểm thử và cập nhật kết quả vào tài liệu.
*   **Với Bug mới:** Dev viết `DETAIL_DESIGN.md` tập trung vào phân tích nguyên nhân gốc rễ (Root Cause), khoanh vùng ảnh hưởng (Impact Scope) và kế hoạch sửa lỗi (Fix Strategy), đảm bảo viết bài test hồi quy (regression test).
*   **Đồng bộ hóa Master Docs (Reconciliation):** Trước khi đóng ticket và commit code, Agent tự động phát hiện các thay đổi về kiến trúc, database hoặc API để cập nhật ngược lại các tài liệu master (`ARCHITECTURE.md`, `API.md`, `ERD.md`, `SPEC.md`) và ghi nhận vào nhật ký quyết định (ADR).

### 3. Ghi nhận Phiên bản & Phát hành
*   Mỗi khi hoàn thành một Epic hoặc Phase, PM/Agent viết `Release Notes`.
*   Cập nhật lịch sử thay đổi lớn vào `changelogs`.

---

## V. Các Chốt Chặn Kỷ Luật & Giải Pháp Cho Lỗ Hổng Quy Trình

Để giải quyết dứt điểm tình trạng AI "nói dối", "đoán mò" hoặc "quên tài liệu", framework tích hợp các cơ chế cứng rắn:

> [!IMPORTANT]
> **Chốt chặn 1: QA-for-Docs (Rà soát tài liệu)**
> Trước khi hoàn thành ticket, một Agent reviewer sẽ quét code thực tế vừa viết và đối chiếu với `ARCHITECTURE.md` hay `ERD.md`. Nếu phát hiện code thay đổi (ví dụ: thêm bảng mới) mà tài liệu chưa được cập nhật, ticket sẽ bị **từ chối đóng** và bắt buộc sửa tài liệu.

> [!TIP]
> **Chốt chặn 2: Pay-as-you-go Documentation (Tài liệu cuốn chiếu)**
> Đối với dự án cũ (Brownfield), cấm AI quét toàn bộ dự án để vẽ Master Docs vì sẽ cắn nốt token và sinh rác. Agent chỉ cần phân tích và cập nhật Master Docs cho đúng module/thư mục mà Ticket hiện tại chạm vào. Hệ thống tài liệu sẽ đầy dặn dần lên theo tiến độ sửa task.

> [!WARNING]
> **Chốt chặn 3: Execution-based Verification (Xác thực thực tế)**
> AI không được phép tự tuyên bố test đã pass. Agent phải chạy lệnh terminal kiểm thử thực tế (ví dụ: `npm run test`) và chụp/parse kết quả Terminal output đó nhét vào phần `Verification Results` trong file `DETAIL_DESIGN.md`.

---

## VI. Sơ đồ Vòng đời hoạt động của Agent (Agent Lifecycle)

```text
  [Human / PM] Tạo Ticket (Task/Bug)
               |
               v
+------------------------------------------+
| PHASE 1: HYDRATION & CONTEXT CHECK       |
| - Agent đọc CONTEXT.md + Master Docs     |
| - Xác định: Greenfield hay Brownfield?   |
+------------------------------------------+
               |
               v
+------------------------------------------+
| PHASE 2: DETAIL DESIGN (Chốt chặn 1)     |
| - Agent viết DETAIL_DESIGN.md            |
| - Nếu là BUG: Viết Root Cause + Impact   |
| - CHỜ HUMAN DUYỆT (Approved: True)       |
+------------------------------------------+
               |
               v
+------------------------------------------+
| PHASE 3: EXECUTION & TEST                |
| - Agent checkout branch theo Convention  |
| - Viết mã nguồn + Viết Unit Test         |
| - Chạy lệnh Test -> Parse kết quả vào log|
+------------------------------------------+
               |
               v
+------------------------------------------+
| PHASE 4: RECONCILIATION (Chốt chặn 2)    |
| - Agent tự động diff code & master docs  |
| - Log ADRs nếu có Quyết định thiết kế mới|
| - Đồng bộ hóa Master (ARCHITECTURE/API)  |
+------------------------------------------+
               |
               v
+------------------------------------------+
| PHASE 5: DEHYDRATION & UPDATE STATE      |
| - Cập nhật trạng thái mới vào CONTEXT.md |
| - Lưu trữ Ticket vào Completed/          |
+------------------------------------------+
```