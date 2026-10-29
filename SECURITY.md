# Security Threat Model & Defense Strategy

## 1. Security Philosophy
This system adheres to the principle: **"Make common attendance cheating techniques difficult through multiple layers of verification."**
We explicitly acknowledge that no client application is trusted, and no digital system is 100% immune to physical proxy attacks (e.g. handing a physical phone to a classmate).

---

## 2. Threat Vector Matrix & Mitigations

| Threat Vector | Attack Description | Mitigation Mechanism |
| :--- | :--- | :--- |
| **Static QR Sharing** | Student takes a photo of projected QR code and sends it via instant messaging to an absent classmate. | Short-lived dynamic QR tokens (10-15s expiration), 3-stage sequence requirement, short session attempt timeout (1-3 min). |
| **Out-of-Order Scanning** | Student attempts to skip QR1 or scan QR3 first. | Server-side attempt state machine. Scans are checked against `attempt.current_stage + 1`. Wrong sequence immediately fails. |
| **Token Replay Attack** | Student intercepts or copies a QR token string and reuses it in a later session or request. | Single-use/stage-bound tokens verified against active session database state. |
| **Direct API Forgery** | Student uses Postman / cURL to post `{ stage: 3, status: 'VERIFIED' }`. | Server ignores client-supplied status or stage parameters. Student identity is extracted strictly from verified JWT cookie/header. |
| **Duplicate Attendance** | Student attempts to record attendance multiple times for the same session. | Database enforces `UNIQUE(student_id, attendance_session_id)`. Scan completion runs inside an isolated atomic SQL transaction. |
| **Phone Swap / Extended Attempt** | Student starts attendance, leaves classroom or gives phone to a friend to scan remaining codes later. | Strict attempt timeout countdown + client HTML5 Page Visibility API triggering automatic attempt invalidation on backgrounding/blur. |
| **Cross-Session QR Reuse** | QR code from CS101 applied to CS102. | Tokens explicitly embed and check `attendance_session_id` on backend. |

---

## 3. Honest System Limitations
1. **Physical Phone Delegation**: If Student A gives their unlocked device to Student B inside the classroom, Student B can scan on Student A's behalf.
2. **Account Credential Sharing**: If Student A shares their username/password with Student B, Student B could log into Student A's account. (Mitigated by single active device session constraints).
3. **Camera Screen-Capture Speed**: A remote student with ultra-fast live video relay could scan a live-streamed screen within 5-10 seconds. (Mitigated by overall short session timer and sequence constraints).
