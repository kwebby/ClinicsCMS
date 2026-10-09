<!-- Author: ramanpal singh | URL: https://kwebby.com -->
# Using the ClinicsCMS workspace

After [installing ClinicsCMS](INSTALLATION.md), sign in at `/login` with your installation account. A fresh clone has no shared accounts; the optional fictional demo is created through [local development setup](DEVELOPMENT.md). The public clinic name is configured independently from the ClinicsCMS product name.

The workspace re-checks your session when you return to the tab. If it has expired, you are sent to sign in and then returned to the page you were on; only same-site paths are accepted as a return address.

## Dedicated pages

Create, view, edit, and action screens each have their own address. Open a record from a table, calendar, or board; use its edit or action link for the next step. The browser Back button and the page breadcrumbs return to the previous work. Reloading a saved record, conversation, revision, or theme preview opens the same item.

Clinical signatures, invoice issuance, payments, result review, and actions needing additional information use dedicated pages. These pages show the relevant fields and validation errors inline. Unsaved-form cancellation offers an inline discard choice. Routine work does not open application dialogs or browser confirmation prompts. Native date/file pickers and BlockNote formatting menus remain available.

Record and action forms retain up to 20 unsaved drafts in private tab memory for 30 minutes after their last change. Navigating back to a form restores its values and original record version; an outdated draft is blocked from silently overwriting a newer record. Drafts clear when discarded or successfully saved, on logout, and when a different account signs in; an expired session keeps them, so signing in again as the same person restores your work. Save before refreshing or closing the tab: this temporary recovery uses no persistent browser storage. Clinical/CMS draft autosave remains available on supported existing records; action forms never submit automatically.

## Finding records

Tables load 50 records at a time, most recent first; choose **Load more** for the next page. Search runs on the server across each record type's main display fields, and the status tabs filter on the server too. Patient names in a table are looked up only for the rows shown.

Fields that refer to another record, such as **Patient** or **Appointment**, are search boxes: type part of a name and choose a match from the list with the mouse or the arrow and Enter keys. The current selection keeps its name when you edit a record. Staff fields such as **Doctor** and **Assigned to** remain dropdowns. When editing, emptying an optional field and saving clears it.

Date and time fields use the clinic timezone, or the record's branch timezone when that branch has a published website location with its own timezone.

## Quick changes from a table

The **Quick actions** column contains permitted status changes for appointments, inquiries, and tasks. It also provides leave approval/rejection and notification read controls. Actions requiring more information open their dedicated page: for example, closing an inquiry requires a closure reason, and converting it to Booked requires an appointment.

A change becomes visible only after the server accepts it. If someone else updated the record first, an inline error asks you to refresh; the existing version is not silently overwritten. Clinical signatures and financial actions retain their full workflow and permissions.

## Calendar

Appointments and leave have **Table** and **Calendar** views. The calendar supports month, week, and day periods, previous/next navigation, and **Today**. Times use the clinic's configured IANA timezone. Multi-day leave appears on each affected calendar date. Open an event to see its dedicated record page.

The view is reflected in the URL, for example `/workspace/appointments?view=calendar`. Search and status filters apply to the calendar. It reads at most the 1,000 most recently created matching records and says so when older ones are left out; use search or the table to reach them. On a narrow screen, scroll within the calendar when needed.

## Kanban progress

Appointments, inquiries, and care tasks have a **Kanban** view. Move an authorized card by dragging it onto a supported column or choosing a status from its labeled **Move** selector. The selector also supports keyboard and touch use. Open the card title to read the full record. Each column shows its 100 most recently created cards, with a note when a column has more.

Care tasks support **Open**, **In progress**, **Blocked**, and **Completed**. Completed tasks can be reopened. An assignee can update their own permitted tasks; owners, administrators, and managers can manage tasks within their authorized scope. Other readable tasks do not expose move controls.

Inquiry stages and appointment transitions follow the same rules as the table and dedicated action pages. Unsupported transitions are rejected, and stages requiring additional fields open the corresponding action page.

## Patient and website work

The patient portal has separate appointments, documents, invoices, results, conversations, notifications, and preferences pages. It shows only the patient records linked to the signed-in account, and lists load 25 items at a time with **Show more**. Staff accounts that open `/portal` are sent to the workspace. Visit preparation uses `/portal/intake`; saved intake notes are available from the document detail page.

Theme creation, ZIP upload, customization, and preview also use separate pages. Public BlockNote image uploads take an accessible description inline before the file is uploaded and scanned.

**Website settings** opens dedicated pages for homepage sections, colors/fonts, header/footer, locations/NAP, SEO/social defaults and preview. Section and location editing have their own URLs. Save a website draft, review it, then activate a theme to publish an immutable snapshot. See the [website settings guide](WEBSITE-SETTINGS.md) and [24-clinic research](../artifacts/research/clinic-sites-2026-10/README.md).
