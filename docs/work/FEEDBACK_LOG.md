---
artifact_type: feedback_log
id: FEEDBACK_LOG
status: active
owner: shared
human_fields:
  - raw_feedback
  - source
  - triage_override
ai_fields:
  - type_recommendation
  - severity
  - converted_artifact
  - notes
shared_fields:
  - feedback_items
  - status
updated: 2026-08-23
---

# Feedback Log

## FB-004 — Resilient social media agent gateway

- Date: 2026-08-23
- Source: Owner, active Codex thread
- Raw feedback: Tách PostgreSQL thành hai schema cho bot và gateway; xử lý/retry media tải lỗi; tập trung TikTok, Instagram và Facebook dựa trên extension tham khảo; mọi upload vào một Google Drive folder cố định, lưu Drive ID; tạo plan/docs cho các phần còn thiếu để theo dõi tiến độ.
- Triage: Feature, high-risk because it changes database schema, runtime jobs, external Drive behavior, public API/MCP and permissions.
- Resolution: Converted into PHASE-004, DESIGN-004/DESIGN-005, ADR-003 and TICKET-008..011. Implementation approval is still pending.
- Status: converted

## FB-003 — Personal/simple full-control mode

- Date: 2026-08-20
- Source: Owner
- Feedback: Đây là dự án cá nhân; extension khởi động phải có thể điều khiển toàn bộ browser thay owner, không cần workflow phức tạp.
- Resolution: Bỏ account/workspace/pairing/tab grants/approval/audit DB/SQLite khỏi MVP; chốt shared token, auto-connect, global On/Off và full Chrome API/CDP capability.
- Status: resolved

## Feedback Items

| ID | Date | Raw Feedback | Source | Type | Status | Converted Artifact | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FB-001 | 2026-08-20 | Nghiên cứu giải pháp mã nguồn mở phù hợp cho agent điều khiển Chrome thật từ xa. | Hội thoại lưu tại file HTML ở repository root | Feature | converted | `REQ-MASTER`, `ADR-001` | Open Browser Control được đề xuất làm nguồn fork; Playwright MCP là phương án POC. |
| FB-002 | 2026-08-20 | Viết SRS và planning, khởi tạo từ template `dungxbuif/harness`. | Yêu cầu trực tiếp của người dùng | Enhancement | converted | `REQ-MASTER`, `ROADMAP`, `PHASE-001` | Phạm vi hiện tại là tài liệu và kế hoạch; chưa cho phép triển khai runtime. |
| FB-004 | 2026-08-23 | Hai schema `gateway`/`bot`; retry media lỗi; TikTok/Instagram/Facebook; một Drive folder; lưu Drive ID; lập docs/plan phần còn thiếu. | Owner, active Codex thread | Feature | converted | `PHASE-004`, `DESIGN-004`, `DESIGN-005`, `ADR-003`, `TICKET-008..011` | High-risk; docs created, implementation approval pending. |
