<!-- Author: ramanpal singh | https://kwebby.com -->
# Official outpatient clinic website research

Retrieved **9 October 2026**. **24 businesses** across **12 countries/markets**. This report describes observed public website content, not medical quality, conversion rates, search rankings or Google Business Profile correctness.

The sample was used to choose the default homepage sections and the location/SEO controls. Business names, per-site observations and raw per-site data are not published; only the aggregate findings below are kept.

## Method and counting limits

Purposive English-language public official-site sample of outpatient practices and local/small clinic groups; not random or representative.

Official homepage plus contact/location documents; read-only HTML/text/link/image-metadata review. No forms submitted, accounts created, or businesses contacted.

Curated source-document order after excluding repeated responsive navigation, footer utilities and cookie content. This is not a pixel-based layout or interaction audit.

Image alt/src metadata and adjacent text; no assumption that image appearance, authenticity or accessibility was verified.

Observed website name/address/phone compared across inspected documents and repeated regions. Branch, fax, after-hours, registered-office and unlabeled numbers are separated. Google links are only presence observations; external listing consistency and GBP ownership were not verified.

Country/market mix: United States (4), United Kingdom (4), Australia (4), Singapore (2), India (1), New Zealand (2), Canada (1), Ireland (1), South Africa (1), United Arab Emirates (1), Malaysia (1), Hong Kong (2).

## Homepage body section prevalence

A site counts once per category. A CTA in the header does not count as a booking section; a footer-only testimonial does not count as a body testimonial. Categories can overlap in one combined section. Presence does not prove effectiveness.

| Section category | Sites | Share |
|---|---:|---:|
| Introductory hero | 24/24 | 100.0% |
| Services overview | 22/24 | 91.7% |
| Clinic introduction / care model | 19/24 | 79.2% |
| Dedicated booking / next-step section | 16/24 | 66.7% |
| Location / contact / directions | 13/24 | 54.2% |
| Care benefits / differentiators | 12/24 | 50.0% |
| Patient testimonials / reviews | 10/24 | 41.7% |
| Clinician / team introduction | 9/24 | 37.5% |
| News / updates / media feature | 9/24 | 37.5% |
| Accreditation / press / credibility | 7/24 | 29.2% |
| Patient information / health resources | 6/24 | 25.0% |
| Opening-hours block | 5/24 | 20.8% |
| Partner services | 3/24 | 12.5% |
| Frequently asked questions | 3/24 | 12.5% |
| Fees / membership / payment | 3/24 | 12.5% |
| Care / enrollment steps | 1/24 | 4.2% |
| Social follow invitation | 1/24 | 4.2% |
| Employer / corporate care | 1/24 | 4.2% |
| Newsletter sign-up | 1/24 | 4.2% |

## Linked page-type prevalence

These categories come from inspected page bodies and public navigation/link inventories. They do not imply one unique page per category, or that every linked target was fetched. A combined booking/contact page can serve both purposes.

| Linked page type | Sites | Share |
|---|---:|---:|
| contact | 21/24 | 87.5% |
| about | 20/24 | 83.3% |
| services | 20/24 | 83.3% |
| service_detail | 17/24 | 70.8% |
| team | 15/24 | 62.5% |
| pricing | 14/24 | 58.3% |
| booking | 13/24 | 54.2% |
| legal | 13/24 | 54.2% |
| blog_news | 13/24 | 54.2% |
| patient_resources | 11/24 | 45.8% |
| location | 9/24 | 37.5% |
| corporate | 8/24 | 33.3% |
| practitioner_detail | 8/24 | 33.3% |
| careers | 8/24 | 33.3% |
| faq | 5/24 | 20.8% |

## Reusable homepage recommendation

Inference from the observed patterns: provide ten principal section types—hero, services, clinic introduction, care benefits, team, testimonials, fees/payment, location/contact/hours, FAQs, and appointment CTA. Make each reorderable, hideable and repeatable where meaningful. Team, FAQ and fees are useful options even where their sample prevalence is below the strongest core sections; do not present them as universal requirements.

Suggested initial order: hero → services → clinic introduction/benefits → team → testimonials → fees/payment → locations/hours → FAQs → closing appointment CTA. Clinic introduction and benefits can share one section, giving nine initial slots. Add news/resources, accreditation/press, process, partners, corporate care and newsletter modules as optional library entries. The sample supports variation: Prahran East leads with opening hours and updates; Harley Street General Practice emphasizes heritage, philosophy, fees and employer care.

Header and footer should be separate editable regions. Header: identity, compact navigation, booking and a correctly labeled phone action. Footer: location-aware NAP, opening hours, legal/patient links and optional social links. Store contact details by location and reuse the same records in all regions.

## Mapping to the implemented website controls

Source snapshot reviewed on **9 October 2026**. The recommendations above describe the research-derived library; the table below records what the current application sources implement. It does not report deployment status or replace the application's browser tests. The 24-site dataset and all prevalence counts remain unchanged.

| Research finding | Current implementation | Source evidence |
|---|---|---|
| A common core with substantial variation | Nine starter slots, in order: hero, services, about, care team (`doctors`), testimonials, pricing, locations, FAQ, closing CTA. About, testimonials, pricing and FAQ start hidden until the clinic supplies content. Sections support editing, visibility and reordering. | [Shared section contract and defaults](../../../packages/contracts/src/website.ts), [homepage editor](../../../apps/web/components/website-editor-pages.tsx) |
| Additional content belongs in an optional library | Thirteen available types: `hero`, `trust`, `services`, `about`, `doctors`, `process`, `pricing`, `testimonials`, `locations`, `faq`, `resources`, `lead-tool`, `cta`. “Team” in this research maps to `doctors`; location/contact/hours maps to `locations`; booking/next-step maps to `cta`. The editor permits up to 20 section instances. | [Catalog and bounded content schema](../../../packages/contracts/src/website.ts) |
| Separate editing tasks should have dedicated screens | Website workspace routes cover homepage, branding, navigation, locations, SEO and preview under `/workspace/website`; homepage sections and individual locations have their own detail routes. Header/footer controls are separate from homepage sections. | [Website route layout](../../../apps/web/app/workspace/website/layout.tsx), [settings screens](../../../apps/web/components/website-editor-pages.tsx) |
| Typography should support clinic branding and relevant scripts | Nine curated Google Fonts families plus system fallback, with separate heading/body selection and a searchable preview. The nine families are self-hosted: Inter, Source Sans 3, Manrope, DM Sans, Source Serif 4, Lora, Noto Sans, Noto Sans Devanagari and Noto Sans Gurmukhi. Bundled licenses, source URLs and checksums accompany the font files. This is a fixed curated catalog, not a live browser of every Google font. | [Branding/font controls](../../../apps/web/components/website-editor-pages.tsx), [font assets and provenance](../../../apps/web/public/fonts/README.md) |
| Repeated branch details need one canonical record | Location records supply branch pages, homepage/contact details and `MedicalClinic` structured data; the primary location supplies shared site identity/header/footer details. Canonical URLs and published, indexable pages feed the generated sitemap. Display-phone digits must match the canonical phone. Hours, date exceptions, map/profile URLs, coordinates, accessibility and parking have fields. | [Location contract](../../../packages/contracts/src/website.ts), [public identity](../../../apps/api/src/controllers.ts), [schema and sitemap generation](../../../packages/platform/src/seo.ts) |
| Website consistency and external listing correctness are different checks | A NAP reference CSV exports canonical details and marks external listings for manual verification. Recording a Google profile link does not verify ownership, listing accuracy or a Local Pack position. | [Location settings and CSV export](../../../apps/web/components/website-location-settings.tsx) |

Desired future additions, rather than implemented claims: dedicated fax, after-hours and department-contact fields; richer multi-interval/overnight hours; specialized newsletter, partner or corporate modules where a clinic needs them; automated external-listing reconciliation; and an optional full Google Fonts catalog integration. Benefits can currently use about/trust content, and news can use resources linked to article pages; they are not separate named types in the 13-type catalog. The Google Fonts Developer API can provide searchable family/style/subset metadata and requires an API key; implementing that live integration would be additional work. Self-hosting is permitted subject to each font's license. [Google Fonts Developer API](https://developers.google.com/fonts/docs/developer_api), [official Google Fonts repository and licensing](https://github.com/google/fonts).

The local-search rationale is accurate business representation and useful branch information. Google asks businesses to use their real-world name, precise location and appropriate phone/hours; local results also depend on relevance, distance and how well known the business is. These controls do not establish a ranking uplift or guarantee a Local Pack placement. [Business Profile representation guidelines](https://support.google.com/business/answer/3038177), [Google's local-ranking guidance](https://support.google.com/business/answer/7091).

Structured data should describe accurate visible location facts using an appropriate specific business type. Google does not guarantee rich-result display. Testimonials on a clinic's own website are not a basis for promising review stars: Google's rules exclude self-serving `LocalBusiness`/`Organization` reviews from that feature, including controlled third-party widgets. Branch pages should serve real patient needs; mass-produced similar city pages can fall within doorway-abuse policies. [Local business structured data](https://developers.google.com/search/docs/appearance/structured-data/local-business), [review-snippet rules](https://developers.google.com/search/docs/appearance/structured-data/review-snippet), [spam policies](https://developers.google.com/search/docs/essentials/spam-policies).

## Local page architecture recommendation

Use a homepage; services hub with optional substantive service detail pages; team directory with optional practitioner profiles; fees/payment page; patient information/FAQs; contact/booking; and one page per real clinic location for a multi-site group. News, corporate care and careers are optional. A single-site practice may combine contact, directions and booking, as observed in Prahran East; a small group needs branch-specific addresses, phones, hours and booking destinations.

A location record should contain display/legal name mapping, address, primary telephone, separately labeled fax and after-hours contacts, weekly hours and exceptions, transport/accessibility/parking notes, booking URL, map/directions URL and an optional GBP/profile URL. Distinguish planned locations from operating ones. Do not multiply near-identical suburb/service pages merely because the CMS allows it; this sample did not establish an effectiveness benefit for doing so.

Keep rendered telephone labels and tel: destinations synchronized. Compare repeated office hours as well as NAP. Explicitly labeled registered-office, fax, locum and after-hours details are legitimate differences, not automatic conflicts. These product recommendations are inferences from website content and observed discrepancies, not claims about ranking effects.

## Scope and bias

This purposive sample favors English-language, search-discoverable, metropolitan, private and membership-oriented practices. The US subset emphasizes direct primary care; the UK subset is London-heavy; the Australia subset is Melbourne-heavy. Small groups are included where branch navigation is observed, but corporate independence and current active-location counts were not comprehensively verified. HTML source order can differ from rendered responsive layout; widgets, images, menus and dynamic counters may need visual/interaction follow-up. Only a few documents per site were inspected. Retrieved content and sitemap declarations can change.

Two further candidates were excluded and replaced: one could not be retrieved securely, and one had too little auditable homepage text. Neither is counted in the 24-site denominator.

## Data files

- [`homepage-section-frequency.csv`](homepage-section-frequency.csv): homepage body section prevalence (category, label, sites, sample size, percent).
- [`page-type-frequency.csv`](page-type-frequency.csv): linked page-type prevalence (category, sites, sample size, percent).
