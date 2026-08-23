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
updated: 2026-08-20
---

# Feedback Log

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
