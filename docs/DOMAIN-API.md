<!-- Author: ramanpal singh | URL: https://kwebby.com -->
# ClinicsCMS domain API

All methods receive the server-resolved Actor. Reads and writes enforce organization, branch, assigned patient and role. `expectedVersion` is required on PATCH and versioned lifecycle mutations; stale changes return 409. In PATCH, `null` removes an optional field; `null` for a required field is a `VALIDATION` error. Use ISO UTC timestamps; dates are YYYY-MM-DD. Amounts are decimal strings, never floating point, and amounts with more decimals than the currency allows are rejected (`MONEY`), never rounded. IDs are strings. All inputs reject unknown fields and any string or key containing a NUL character.

An account holding both staff and patient roles sees a record either through a staff role that may itself read that collection (with the usual branch and ownership rules) or through the linked-patient rules; patient membership never opens the staff path. A patient sees a conversation only while it concerns one of their linked patients.

## Collection shapes

Common generated fields: id, organizationId, version, createdAt, updatedAt. Input fields below are writable; generated states are omitted from inputs.

- patients: `branchId, name, dateOfBirth?, email?, phone?, address?, allergies?: string[], medicines?: string[], emergencyContact?: {name,phone,relationship}`. Sharing email/phone never merges records.
- appointments: `branchId, patientId, doctorId, startsAt, endsAt, reason?, kind?: consultation|follow-up|walk-in`. Create books transactionally. Starts more than 5 minutes in the past are rejected (`START_IN_PAST`); staff may record a `walk-in` that started up to 60 minutes ago. A patient cannot hold overlapping active appointments, even with different doctors (`PATIENT_BOOKED`, 409). Generated status: booked/arrived/in-progress/completed/cancelled/no-show.
- availability: `branchId, doctorId, weekday:0..6, startTime:HH:MM, endTime:HH:MM, timezone, slotMinutes`. Clinic-local weekday/time, ISO appointment input.
- leave: `branchId, employeeId, startsAt, endsAt, reason?`; approval is action-controlled.
- encounters: `branchId, patientId, appointmentId?, doctorId, content:BlockNoteJSON[], observations?: {bloodPressure?,pulse?,temperature?,weight?,height?}, diagnosis?:string[], followUpAt?`. Creates draft.
- prescriptions: `branchId, patientId, encounterId, medications:[{name,dose,route,frequency,duration,instructions?}], instructions?`. Doctor creates draft; sign action freezes snapshot.
- results: `branchId, patientId, title, reviewerId, coveringReviewerId?, fileId?, critical?:boolean, dueAt?`. Independent reviewState, contactState and actionState.
- referrals: `branchId, patientId, encounterId?, destination, reason, assignedTo?`.
- tasks: `branchId, title, assignedTo, patientId?, dueAt?, priority?:normal|high|urgent, category?:administrative|clinical|finance, description?`. Initial status `open`; progress is `open` / `in-progress` / `blocked` / `completed` and changes only through lifecycle actions.
- leads: `branchId, name, email?, phone?, source, interest?, assignedTo?, callbackAt?, marketingConsent?:boolean, attribution?:{utmSource?,utmMedium?,utmCampaign?,referrer?}, notes?:BlockNoteJSON[]`. Initial stage new.
- employees: `branchId, userId?, name, email, jobTitle, salary:{currency,base,earnings?:[{label,amount}],deductions?:[{label,amount}]}, joinedOn?`. Nobody creates or edits the employee record linked to their own account (`SEPARATION_OF_DUTIES`).
- services: `branchId, name, description?, price, currency, durationMinutes, public?:boolean, taxRate?:decimalString`. `price` must use the currency's decimals and is stored normalized (e.g. `10.5` → `10.50`).
- invoices: `branchId, patientId, currency, lines:[{description,quantity,unitPrice,taxRate?,discount?}], notes?:BlockNoteJSON[], dueAt?, templateId?`. Quantity/price/rate/discount decimal strings. Amount discount per entire line; line tax applies after discount. Generated exact totals. Creates draft.
- payroll: `branchId, period:YYYY-MM, employeeIds:string[] (1–200), adjustments?:[{employeeId,label,amount,kind:earning|deduction}], templateId?`. Draft snapshots salary terms and records `createdBy`. Approval creates frozen payslip documents and must be performed by someone other than the creator. The 200-employee cap keeps approval (two writes per employee plus five) inside the Firestore transaction limit and applies on every database; split larger pay runs.
- templates: `branchId?, name, kind:invoice|payslip, content?:BlockNoteJSON[], design:{accent,font:system|serif|mono,showLogo,columns:string[],footer?,terms?}}`.
- pages: `branchId?, title, slug, kind:home|location|doctor|service|medical|article|faq|about|contact|directory|tool|vendor, locale, content:BlockNoteJSON[], seo?:{title?,description?,canonical?,indexable?,socialTitle?,socialDescription?,socialImage?,socialImageAlt?,schemaTypes?:string[],schema?:object,translations?:[{locale,slug}]}, reviewedBy?, citations?:[{title,url}]`. Slugs (and translation slugs) cannot start with an application route segment: `api`, `booking`, `login`, `register`, `setup`, `portal`, `workspace`, `tools`, `accept-invite`, `verify-email`, `reset-password`, `sitemaps`, `sitemap.xml`, `robots.txt`, `opengraph-image`, `socket.io`, `_next`, `fonts` (`RESERVED_PAGE_ROUTES` in the website contract). HTTPS URLs (citations, canonical links) cannot contain credentials, whitespace or backslashes. Block content rejects executable properties in any letter case, including every `on*` handler, `dangerouslySetInnerHTML`, `innerHTML`, `srcdoc`, `style` and `srcset`.
- conversations: `branchId, title, kind:staff|patient-service|clinical, participantIds:string[], patientId?, assignedTo?`.
- consents: `branchId, patientId, purpose:care|marketing|ai|caregiver|reminders, granted:boolean, versionLabel, source`.
- settings: `key:business|localization|notifications|website|ai-policy`, `value:object`. Values are strictly validated; credentials belong in platform integration settings.
- payments/refunds/messages/notifications/documents/themes/publications: generated or managed by dedicated lifecycle/platform actions; generic write is denied.

## Lifecycle actions

All request bodies are JSON. `{id, expectedVersion}` identifies existing records unless listed otherwise.

- `appointments.book`: same as appointment create. `appointments.reschedule`: id/expectedVersion/startsAt/endsAt/doctorId(optional). `appointments.status`: id/expectedVersion/status (valid lifecycle transition).
- `encounters.save`: id/expectedVersion/content/observations?/diagnosis?/followUpAt?. `encounters.sign`: id/expectedVersion. `encounters.amend`: id/expectedVersion/reason/content; freezes an amendment and retains original.
- `prescriptions.sign`: id/expectedVersion; signing doctor must own encounter.
- `results.review`: id/expectedVersion/summary/actionRequired:boolean. `results.contact`: id/expectedVersion/outcome:attempted|communicated/note. `results.action`: id/expectedVersion/note. `results.reassign`: id/expectedVersion/reviewerId/coveringReviewerId?; only while review, a required action or release is outstanding (otherwise 409 `STATE`). `results.release`: id/expectedVersion.
- `tasks.status`: `{id,expectedVersion,status:open|in-progress|blocked|completed,note?}`. Any unfinished stage may move to another unfinished stage or `completed`; a completed task may only return to `open`. Same-stage requests return 409. The assignee or an owner/admin/manager with existing task visibility may update progress; branch, organization, clinical/finance category and patient access restrictions still apply. Every accepted change records `statusNote`, `statusChangedAt`, `statusChangedBy` and an audit entry. Completion records `completionNote`, `completedAt`, `completedBy`; reopening clears those completion fields. `tasks.complete`: `{id,expectedVersion,note?}` remains a compatibility action for completing any unfinished stage; already completed tasks return 409.
- `leave.approve`: id/expectedVersion/approved:boolean. Nobody approves leave for their own account; rejecting (withdrawing) it is allowed.
- `leads.transition`: id/expectedVersion/stage:new|contacted|qualified|booked|closed/closureReason?/appointmentId?. `leads.contact`: id/expectedVersion/note/outcome/callbackAt?.
- `invoices.issue`: id/expectedVersion. `payments.record`: invoiceId/amount/method:cash|bank/reference?/idempotencyKey. `refunds.record`: paymentId/amount/reason/idempotencyKey; manual methods only.
- `payroll.approve`: id/expectedVersion. `payroll.pay`: id/expectedVersion/reference. `templates.publish`: id/expectedVersion; publishes a draft once (edit the template to publish a new version). `pages.publish`: id/expectedVersion. `pages.restore`: id/expectedVersion/revisionId; the restored fields are validated and relation-checked like an edit (location URLs, published media, reviewer) and the page returns to draft. `documents.release`: id/expectedVersion.
- `conversations.send`: conversationId/body/attachmentIds?:string[]/idempotencyKey. `conversations.read`: id. `conversations.transfer`: id/expectedVersion/assignedTo/participantIds.
- `notifications.read`: id. `consents.record`: same shape as consent create.
- `notifications.preferences`: categories:string[], email:boolean, inApp:boolean, quietStart?:HH:MM, quietEnd?:HH:MM, timezone.

Public projections must be generated by the API/platform; never call generic list with a fabricated public administrator. A patient can create their own appointment, intake draft, administrative message and consent, but cannot set reviewer, clinical signature, invoice state, staff roles, or salary data. Generic PATCH cannot change record ownership, lifecycle state, clinical history, issued values or secrets.

## Additional complete workflows

- `patients.intake`: `{patientId,appointmentId?,content,allergies?:string[],medicines?:string[]}` creates a private, patient-scoped intake document; self-reported information never silently overwrites the medical chart.
- `prescriptions.save`: `{id,expectedVersion,medications,instructions?}` edits only drafts owned by the prescribing doctor.
- `referrals.complete` / `referrals.release`: `{id,expectedVersion,note?}`; release requires a doctor, happens once, and, when the referral has an assignee, only the assignee may release it.
- `invoices.credit`: `{invoiceId,amount,reason,idempotencyKey}` issues an immutable credit note against unpaid balance. If reducing a paid amount, first record the appropriate refund. Credit notes preserve the original issued invoice snapshot and have private document records of kind `credit-note`.
- `pages.review`: `{id,expectedVersion,note?}` records an actual doctor review bound to the exact title/body/citations (a SHA-256 over canonical, key-sorted JSON, so it survives database key reordering and migration; hashes recorded before this format still verify). `reviewedBy` in the editor assigns a reviewer; it does not approve publication. Changing or clearing `reviewedBy` (by PATCH or restore) removes the recorded review. Changed medical content requires fresh clinical review.
- `pages.revisions`, `encounters.revisions`, `templates.revisions`: `{id}` returns authorized staff revision history.

All monetary fields are strings in major currency units. Invoice/payslip documents use immutable `snapshot` data; frontend display and PDF generation must use that snapshot. Currency precision comes from `Intl.NumberFormat` (e.g. JPY 0, USD 2, KWD 3); use Decimal conversions for provider minor units.

Issued invoice has `paidAmount`, `balance`, `creditedAmount`, and `snapshot`; invoice draft line input excludes computed `subtotal`, `tax`, `total`. Payment, credit, refund and message replay returns the original record, even after the invoice has since been paid, credited or refunded, and rejects key reuse with different request content. Money arithmetic uses 40 significant digits. Provider callbacks must lock `${organizationId}:invoice:${invoiceId}`, verify authenticity/amount/currency against the server-created checkout, and atomically persist payment, updated invoice, event deduplication and outbox.

Appointments transact on `${organizationId}:schedule:${doctorId}`, including both old and new doctors during rescheduling, plus `${organizationId}:schedule:patient:${patientId}` and the doctor's `user:${doctorId}` key. Leave approval takes the doctor's schedule lock and rejects conflicts with scheduled patients. Appointment start/end use whole ISO minutes; configured availability uses the named IANA timezone. Adjacent appointments are allowed; any time overlap is rejected. Generic writes lock only the record (`${organizationId}:${collection}:${id}`), the users they assign (`user:${userId}`, shared with account administration) and, for pages and settings, `${organizationId}:pages` and `${organizationId}:settings`. Invoice issue locks `${organizationId}:invoice-counter:${branchId}`.

Separation of duties: the creator of a pay run cannot approve it, nobody approves their own leave, and nobody creates or edits their own employee record (`SEPARATION_OF_DUTIES`, 403). An owner is exempt only while no other active account with an approving role (owner/admin/HR, plus manager for leave) can act for that branch, so a single-person clinic can still operate.

## Live publishing and integration

Pages retain `publishedSnapshot` while newer content is a draft. Public serving must select this snapshot, never draft fields or only `status === published`. `pageRoutes` stores published slug/locale ownership and redirects; old routes redirect directly to the latest route. `publications` stores immutable historical page snapshots. Theme publications are independent platform records.

Public CMS medical content cannot publish until reviewed. Signed clinical records cannot be modified by generic PATCH. Role names on employee profiles are descriptive metadata; actual authorization and practitioner validation always uses server-owned `users.roles`, `users.status` and `users.branchIds`.

Settings use a deterministic record id equal to key. Business `value`: `clinicName,country,currency,timezone,locale,address,email,phone`, optional `name,legalName,website,logoFileId,bankDetails,taxLabel`; defaults `businessIds:{},fiscalYearStart:1,invoicePrefix:'INV',publicBooking:true`. Other exact settings schemas are exported from `packages/core/src/schemas.ts`. No credentials are accepted by generic settings.

Core-generated outbox types: `notification.requested`, `appointment.booked`, `appointment.rescheduled`, `appointment.status`, `encounter.signed`, `encounter.amended`, `prescription.signed`, `result.released`, `invoice.issued`, `invoice.credited`, `payment.recorded`, `payment.refunded`, `payroll.approved`, `payroll.paid`, `document.released`, `page.published`, `chat.message`. Payloads contain IDs and routing data, never email or clinical message bodies. Consumers fetch through authorized server workflows and record durable delivery status.


### Public website settings and local identity

`POST /api/v1/records/settings` with `{key:"website", value:...}` and `PATCH /api/v1/records/settings/website` with `{expectedVersion, value:...}` accept the shared strict `websiteSettingsSchema` in `packages/contracts/src/website.ts`. Owner/admin/editor may edit this key. Editors do not gain access to change business, localization, notification, or integration settings. Saves use the existing audit and version-conflict handling.

Existing website metadata remains supported. Optional extensions are `homepage.sections`, `branding`, `locations`, `header`, and `footer`. Homepage sections use a bounded catalog of hero, trust, services, about, doctors, process, pricing, testimonials, locations, FAQ, resources, lead-tool, and CTA primitives. Text, headings, scanned-image references, buttons, cards, questions, order, and visibility remain structured data; no uploaded scripts, HTML, stylesheets, or executable templates are accepted. Approved font IDs select locally packaged fonts; the API never fetches arbitrary font URLs.

All images in these settings use `{assetId, alt, width?, height?}`. The API verifies that the asset belongs to the installation and was separately approved for public use; private file IDs cannot be promoted through settings. Internal image dimensions come from the approved upload result. Button and navigation URLs allow relative paths, HTTPS, telephone, and email links with control characters, protocol-relative paths and credentials rejected.

`locations` stores canonical public NAP independently from legal billing information. Each location has an ID, branch ID, unique public slug, structured postal address, international phone, optional formatted equivalent phone, timezone, weekday hours, dated exceptions, optional coordinates, map/Business Profile links, and access/parking notes. A nonempty set has exactly one primary location. Location slugs cannot claim application routes, CMS page slugs, or permanent redirects. CMS page writes also respect active and draft location slugs; the operations share transaction locks. Business settings and issued invoice snapshots remain unchanged.

Website saves remain drafts, including before the first theme activation. `POST /api/v1/themes/:id/activate` atomically snapshots the current website settings, public business fields, and published pages, and rejects stale publication IDs and URL conflicts. `POST /api/v1/themes/rollback` restores the previous immutable publication. Existing ZIP theme format v1 remains unchanged.

`GET /api/v1/public/site` provides published `website`, `homepage`, `branding`, `locations`, `header`, `footer`, and `navigation` fields. Its legacy identity fields derive from the published website brand and primary location. Before a website is published, only the basic business identity and application bootstrap theme are returned. `theme` exposes only manifest and public IDs; it does not duplicate internal settings. The canonical origin remains the trusted server configuration. Public location pages use the canonical location object for their visible NAP and MedicalClinic JSON-LD, including coordinates, regular/exception hours, and map/profile links.
