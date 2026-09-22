// Seeds illustrative knowledge-base pages (and one demo conversation) so the
// LLM wiki can be reviewed with content in it. Idempotent: pages are matched by
// slug in the global knowledge base and never overwritten.
//
//   node --env-file-if-exists=.env scripts/seed-wiki-demo.mjs
//
// The pages paraphrase material from the ALINA golden-standards work (DPS,
// framework contracts, interinstitutional procurement, ENISA). They are review
// fixtures for the prototype, not legal advice; a curator must validate them.
import { existsSync, readFileSync } from "node:fs";
import pg from "pg";

const { Pool } = pg;

function positiveInteger(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function databaseConfig() {
  const connectionString = process.env.DATABASE_URL?.trim();
  const useTls = process.env.DB_SSL
    ? process.env.DB_SSL === "true"
    : process.env.NODE_ENV === "production";
  const certificate =
    process.env.DB_SSL_CA?.replaceAll("\\n", "\n") ??
    (existsSync("/app/aws-rds-global-bundle.pem")
      ? readFileSync("/app/aws-rds-global-bundle.pem", "utf8")
      : undefined);
  const shared = {
    application_name: "alina-wiki-seed",
    max: 1,
    connectionTimeoutMillis: positiveInteger("DB_CONNECTION_TIMEOUT_MS", 5_000),
    statement_timeout: positiveInteger("DB_STATEMENT_TIMEOUT_MS", 30_000),
    ...(useTls
      ? { ssl: { rejectUnauthorized: true, ...(certificate ? { ca: certificate } : {}) } }
      : {}),
  };
  if (connectionString) return { ...shared, connectionString };
  const host = process.env.DB_HOST?.trim();
  const database = process.env.DB_NAME?.trim();
  const user = process.env.DB_USER?.trim();
  const password = process.env.DB_PASSWORD;
  if (!host || !database || !user || !password) {
    throw new Error("Set DATABASE_URL or DB_HOST, DB_NAME, DB_USER, and DB_PASSWORD.");
  }
  return { ...shared, host, port: positiveInteger("DB_PORT", 5432), database, user, password };
}

const FR = {
  fileName: "Regulation (EU, Euratom) 2024-2509 - Financial Regulation.pdf",
  authorityRank: 2,
};
const VADEMECUM = { fileName: "Vademecum Public Procurement.pdf", authorityRank: 3 };
const DPS_SPECS = { fileName: "DPS Tender Specifications v1.3 - ALINA.docx", authorityRank: 4 };
const CONSULTANTS = {
  fileName: "Guidelines on the use of External Consultants.pdf",
  authorityRank: 3,
};
const CYBER = { fileName: "Cybersecurity Act 2019.pdf", authorityRank: 2 };
const EUIS = { fileName: "List of EUIs_04.2025.xlsx", authorityRank: 4 };

/** @type {Array<{slug:string, parent?:string, title:string, summary:string, status:string, authorityRank:number|null, content:string, sources:Array<object>}>} */
const PAGES = [
  {
    slug: "procurement-procedures",
    title: "Procurement procedures",
    summary:
      "Entry point for the procedure types available to Commission contracting authorities under the Financial Regulation and its Annex I, with the practical layer from the Vademecum.",
    status: "published",
    authorityRank: 2,
    content: `Procurement by Union institutions is governed by Title VII of the Financial Regulation and by the detailed procurement rules in its **Annex I** [1]. The Vademecum on Public Procurement translates those rules into the Commission's internal practice and is the first place to look for *how* a rule is applied [2].

## How this knowledge base is organised

- **Procedure types**: open, restricted, competitive procedure with negotiation, negotiated procedures, dynamic purchasing systems.
- **Contract forms**: framework contracts (single and multiple), direct contracts, specific contracts.
- **Cross-cutting rules**: interinstitutional procurement, exclusion and selection, award criteria, standstill.

Each child page states the governing provision first, then the Commission's implementing guidance, and lists every source it relies on.`,
    sources: [
      { ...FR, locator: "Title VII and Annex I", pageNumber: 87, quote: "The rules on procurement are set out in Annex I." },
      { ...VADEMECUM, locator: "Section 1 - Introduction", pageNumber: 5, quote: "This Vademecum is intended to help Commission staff apply the procurement rules of the Financial Regulation." },
    ],
  },
  {
    slug: "dynamic-purchasing-systems",
    parent: "procurement-procedures",
    title: "Dynamic purchasing systems (DPS)",
    summary:
      "Definition of a DPS in Article 2 of the Financial Regulation, the conditions for using it, and how DIGIT runs the SIDE III DPS in practice.",
    status: "published",
    authorityRank: 2,
    content: `## Definition

The Financial Regulation defines the instrument in its definitions article: "'dynamic purchasing system' means a completely electronic process for making commonly used purchases of items generally available on the market" [1].

## When it may be used

A DPS is set up following the rules of the **restricted procedure** and remains open, throughout its period of validity, to any economic operator that satisfies the selection criteria [2]. Specific contracts are awarded after a mini-competition among the admitted participants.

## In practice at DIGIT

The SIDE III DPS tender specifications describe the two-stage admission (Stage 1 questionnaire, Stage 2 questionnaire) and the mini-competition rules for specific contracts [3]. The Vademecum adds the Commission's operational guidance on running the system, including the handling of requests for participation received during the validity of the DPS [4].

> Related page: *Provisional admission to a DPS* covers what happens between a request for participation and its evaluation.`,
    sources: [
      { ...FR, locator: "Article 2, point (47)", pageNumber: 21, quote: "'dynamic purchasing system' means a completely electronic process for making commonly used purchases of items generally available on the market" },
      { ...FR, locator: "Annex I, point 9", pageNumber: 96, quote: "The contracting authority may use a dynamic purchasing system for commonly used purchases, the characteristics of which, as generally available on the market, meet its requirements." },
      { ...DPS_SPECS, locator: "Section 3 - Admission to the DPS", pageNumber: 12, quote: "Requests for participation may be submitted at any time during the period of validity of the DPS." },
      { ...VADEMECUM, locator: "Section 5.6 - Dynamic purchasing systems", pageNumber: 61, quote: "The contracting authority shall evaluate requests for participation within 10 working days of their receipt." },
    ],
  },
  {
    slug: "provisional-admission-to-a-dps",
    parent: "dynamic-purchasing-systems",
    title: "Provisional admission to a DPS",
    summary:
      "What a request for participation entitles an operator to before its evaluation is complete. Flagged for review after golden-standards question GS-029 was graded Fail.",
    status: "needs_review",
    authorityRank: 2,
    content: `Annex I of the Financial Regulation sets the time limit for evaluating requests for participation received while a DPS is running and states that the contracting authority shall not launch a mini-competition until it has evaluated all requests received within that deadline [1].

The SIDE III tender specifications describe the admission decision and its notification to the candidate [2].

**Open question for the curator.** The golden-standards evaluation (GS-029) expected an answer on *provisional* admission that ALINA did not reach, and the references it produced from the tender specifications pointed at the wrong paragraphs. This page needs a curator to confirm the governing text and the exact locator before it is published.`,
    sources: [
      { ...FR, locator: "Annex I, point 9.2", pageNumber: 96, quote: "The contracting authority shall evaluate requests for participation within 10 working days of their receipt." },
      { ...DPS_SPECS, locator: "Section 3.4 - Admission decision", pageNumber: 14, quote: "Candidates shall be informed of the outcome of the evaluation of their request for participation." },
    ],
  },
  {
    slug: "framework-contracts",
    parent: "procurement-procedures",
    title: "Framework contracts",
    summary:
      "Single and multiple framework contracts, their maximum duration, and how specific contracts are awarded under each form.",
    status: "published",
    authorityRank: 2,
    content: `A framework contract establishes the terms governing specific contracts to be awarded during a given period, in particular with regard to price and, where appropriate, the quantity envisaged [1]. Its duration may not exceed **four years**, save in exceptional cases duly justified by the subject of the framework contract [1].

## Forms

- **Single framework contract**: specific contracts are awarded within the limits of the terms laid down in the framework contract.
- **Multiple framework contract** (see the child page *Multiple sourcing*): concluded with several economic operators, with specific contracts awarded either by reopening competition or by applying the terms of the framework contract (cascade) [2].

The Vademecum details when reopening of competition is mandatory and how to document the choice [3].`,
    sources: [
      { ...FR, locator: "Annex I, point 1.3", pageNumber: 88, quote: "The duration of a framework contract shall not exceed four years, save in exceptional cases duly justified in particular by the subject of the framework contract." },
      { ...FR, locator: "Annex I, point 1.3(c)", pageNumber: 89, quote: "Where a framework contract is concluded with several economic operators, specific contracts shall be awarded either by applying the terms of the framework contract or by reopening competition." },
      { ...VADEMECUM, locator: "Section 5.3 - Framework contracts", pageNumber: 48, quote: "The choice between cascade and reopening of competition must be made in the procurement documents and cannot be changed during implementation." },
    ],
  },
  {
    slug: "multiple-sourcing",
    parent: "framework-contracts",
    title: "Multiple sourcing",
    summary:
      "Definition of multiple sourcing in Article 2 of the Financial Regulation and its use to secure supply from several contractors.",
    status: "published",
    authorityRank: 2,
    content: `The Financial Regulation defines the concept directly: "'multiple sourcing' means a procurement strategy for the purpose of avoiding that the contracting authority becomes dependent on a single contractor, by awarding contracts to several economic operators for the same or similar supplies or services" [1].

In practice this is implemented through multiple framework contracts, with the award mechanism (cascade or reopening) chosen at the outset and stated in the tender documents [2].`,
    sources: [
      { ...FR, locator: "Article 2, point (47a)", pageNumber: 21, quote: "'multiple sourcing' means a procurement strategy for the purpose of avoiding that the contracting authority becomes dependent on a single contractor" },
      { ...VADEMECUM, locator: "Section 5.3.2 - Multiple framework contracts", pageNumber: 50, quote: "Multiple framework contracts secure continuity of supply and maintain competitive pressure over the duration of the contract." },
    ],
  },
  {
    slug: "interinstitutional-procurement",
    title: "Interinstitutional procurement",
    summary:
      "Who may take part in a joint or interinstitutional procedure, and why offices without legal personality (EPSO, OLAF, OIB, PMO) cannot join on their own.",
    status: "published",
    authorityRank: 3,
    content: `Union institutions, executive agencies and Union bodies may conduct procurement procedures on an interinstitutional basis, with one of them acting as lead contracting authority [1].

## Offices without legal personality

The Vademecum is explicit on a point the Financial Regulation leaves implicit: European offices such as **EPSO, OLAF, OIB and PMO** do not have legal personality of their own. They act as part of the Commission and therefore cannot be listed as separate contracting authorities in an interinstitutional call; the Commission participates and covers them [2].

This is the rule behind golden-standards question GS-014: an answer that treats EPSO as a contracting authority in its own right, however well cited from tender specifications, is wrong because the governing text is the Vademecum, not the specifications.`,
    sources: [
      { ...FR, locator: "Article 168 - Interinstitutional procurement", pageNumber: 79, quote: "Where a procurement procedure is conducted on an interinstitutional basis, one Union institution shall be responsible for the procedure." },
      { ...VADEMECUM, locator: "Section 2.4 - Participation in interinstitutional procedures", pageNumber: 19, quote: "Offices without legal personality (EPSO, OLAF, OIB, PMO) cannot participate in their own name; they are covered by the Commission's participation." },
    ],
  },
  {
    slug: "eu-institutions-and-bodies",
    title: "EU institutions, agencies and bodies",
    summary: "Reference entries on Union bodies that appear in DIGIT procedures, compiled from the legal acts establishing them and the DIGIT list of EUIs.",
    status: "published",
    authorityRank: 2,
    content: `Pages in this section identify a body, its seat and the systems it uses, so that answers about participation in DIGIT procedures start from an authoritative description rather than a search across tender documents.`,
    sources: [
      { ...EUIS, locator: "Sheet 'EUIs'", quote: "DIGIT list of EU institutions, agencies and bodies with seat and Ares usage." },
    ],
  },
  {
    slug: "enisa",
    parent: "eu-institutions-and-bodies",
    title: "ENISA - European Union Agency for Cybersecurity",
    summary: "Legal basis, seat and document-management system of ENISA, compiled from the Cybersecurity Act and the DIGIT list of EUIs.",
    status: "published",
    authorityRank: 2,
    content: `ENISA is the **European Union Agency for Cybersecurity**, established by Regulation (EU) 2019/881, the Cybersecurity Act [1]. Earlier texts refer to it as the European Network and Information Security Agency; the current legal name is the one in the 2019 Regulation [1].

## Seat

The Cybersecurity Act recalls that the representatives of the Member States decided that ENISA would have its seat in a town in Greece [2]. The DIGIT list of EU institutions records the seat as **Heraklion (GR)** [3].

## Systems

The same list marks ENISA as **using Ares**, the Commission's document management system, which is relevant when ENISA takes part in a DIGIT interinstitutional procedure [3].`,
    sources: [
      { ...CYBER, locator: "Article 1 - Subject matter", pageNumber: 15, quote: "This Regulation lays down the objectives, tasks and organisational matters relating to ENISA (the European Union Agency for Cybersecurity)." },
      { ...CYBER, locator: "Recital (11)", pageNumber: 3, quote: "the representatives of the Member States decided that ENISA would have its seat in a town in Greece" },
      { ...EUIS, locator: "Sheet 'EUIs', row ENISA", quote: "European Union Agency for Cybersecurity, ENISA — Heraklion (GR) — Using Ares? Yes" },
    ],
  },
  {
    slug: "abnormally-low-tenders",
    parent: "procurement-procedures",
    title: "Abnormally low tenders",
    summary: "Draft compiled from an ALINA answer: the obligation to request explanations before rejecting an abnormally low tender.",
    status: "draft",
    authorityRank: 2,
    content: `Where a tender appears to be abnormally low, the contracting authority shall request in writing the details of the constituent elements of the price or costs that it considers relevant and give the tenderer the opportunity to present its observations [1].

The contracting authority may reject the tender only where the evidence supplied does not satisfactorily account for the low level of price or costs proposed [1]. The Vademecum lists the elements that typically require explanation, such as compliance with applicable social and labour law and the possibility of State aid [2].

*Draft compiled from an ALINA answer. A curator must verify the locators before publishing.*`,
    sources: [
      { ...FR, locator: "Annex I, point 23", pageNumber: 108, quote: "If, for a given contract, tenders appear to be abnormally low, the contracting authority shall request in writing details of the constituent elements of the price or costs." },
      { ...VADEMECUM, locator: "Section 8.4 - Abnormally low tenders", pageNumber: 112, quote: "Explanations may relate in particular to the economics of the manufacturing process, technical solutions chosen, or compliance with environmental, social and labour law." },
    ],
  },
];

// A completed grounded answer, so the Global tab shows the "Save to wiki" action.
const DEMO_CONVERSATION = {
  title: "What is ENISA? Where is their main office? Are they using Ares?",
  question: "What is ENISA? Where is their main office? Are they using Ares?",
  answer: `ENISA is the European Union Agency for Cybersecurity; its seat is in Heraklion, Greece, and according to the DIGIT list of EU institutions and bodies ENISA is using Ares.

From Regulation (EU) 2019/881 ("Cybersecurity Act"): ENISA is defined as "ENISA (the European Union Agency for Cybersecurity)" [1]. On its seat, the Cybersecurity Act recalls that "the representatives of the Member States decided that ENISA would have its seat in a town in Greece" [2], and the DIGIT "List of EUIs_04.2025" specifies the seat location as "Heraklion (GR)" [3].

On the use of Ares, the same List of EUIs shows, in the row for ENISA, a column "Using Ares?" marked "Yes" [3].

**Sources**
- Regulation (EU) 2019/881 on ENISA (Cybersecurity Act) [1][2]
- "List of EUIs_04.2025.xlsx" (DIGIT list of EU institutions, agencies and bodies) [3]`,
  sources: [
    {
      key: "demo-cyber-1", id: "demo-doc-cyber-1", citationNumbers: [1], fileName: CYBER.fileName, title: CYBER.fileName,
      content: "This Regulation lays down the objectives, tasks and organisational matters relating to ENISA (the European Union Agency for Cybersecurity), and a framework for the establishment of European cybersecurity certification schemes.",
      metadata: [{ key: "authority_rank", value: "2" }, { key: "page_number", value: "15" }, { key: "section_title", value: "Article 1 - Subject matter and scope" }],
    },
    {
      key: "demo-cyber-2", id: "demo-doc-cyber-2", citationNumbers: [2], fileName: CYBER.fileName, title: CYBER.fileName,
      content: "The representatives of the Member States, meeting at Head of State or Government level, decided that ENISA would have its seat in a town in Greece to be determined by the Greek Government.",
      metadata: [{ key: "authority_rank", value: "2" }, { key: "page_number", value: "3" }, { key: "section_title", value: "Recital (11)" }],
    },
    {
      key: "demo-euis-1", id: "demo-doc-euis-1", citationNumbers: [3], fileName: EUIS.fileName, title: EUIS.fileName,
      content: "Name,Acronym,Seat,Using Ares?\nEuropean Union Agency for Cybersecurity,ENISA,Heraklion (GR),Yes",
      metadata: [{ key: "authority_rank", value: "4" }],
    },
  ].map((source) => ({ ...source, snippet: source.content.length > 280 ? `${source.content.slice(0, 280)}...` : source.content, contentLength: source.content.length })),
};

const pool = new Pool(databaseConfig());
const client = await pool.connect();
try {
  const { rows: admins } = await client.query(
    "select id from users where role = 'admin' and disabled_at is null order by created_at limit 1",
  );
  if (admins.length === 0) throw new Error("No administrator exists yet. Start the app once with ADMIN_EMAIL/ADMIN_PASSWORD.");
  const authorId = admins[0].id;

  await client.query("begin");
  const idBySlug = new Map();
  let created = 0;
  let skipped = 0;
  for (const [index, page] of PAGES.entries()) {
    const { rows: existing } = await client.query(
      "select id from wiki_pages where project_id is null and slug = $1",
      [page.slug],
    );
    if (existing.length > 0) {
      idBySlug.set(page.slug, existing[0].id);
      skipped += 1;
      continue;
    }
    const parentId = page.parent ? idBySlug.get(page.parent) ?? null : null;
    const { rows } = await client.query(
      `insert into wiki_pages (project_id, parent_id, slug, title, summary, content, status, authority_rank, sort_order,
         created_by_user_id, updated_by_user_id, last_reviewed_at)
       values (null, $1, $2, $3, $4, $5, $6::wiki_page_status, $7, $8, $9, $9, case when $6::text = 'published' then now() else null end)
       returning id`,
      [parentId, page.slug, page.title, page.summary, page.content, page.status, page.authorityRank, index + 1, authorId],
    );
    idBySlug.set(page.slug, rows[0].id);
    for (const [position, source] of page.sources.entries()) {
      await client.query(
        `insert into wiki_page_sources (page_id, position, haystack_file_id, document_id, file_name, locator, quote, page_number, authority_rank)
         values ($1, $2, null, null, $3, $4, $5, $6, $7)`,
        [rows[0].id, position + 1, source.fileName, source.locator ?? null, source.quote ?? null, source.pageNumber ?? null, source.authorityRank ?? null],
      );
    }
    created += 1;
  }

  let conversationCreated = false;
  const { rows: existingConversation } = await client.query(
    "select id from conversations where user_id = $1 and title = $2 limit 1",
    [authorId, DEMO_CONVERSATION.title],
  );
  if (existingConversation.length === 0) {
    const { rows: [conversation] } = await client.query(
      `insert into conversations (user_id, project_id, title, haystack_search_session_id, haystack_pipeline_id)
       values ($1, null, $2, gen_random_uuid(), coalesce(nullif($3, '')::uuid, gen_random_uuid())) returning id`,
      [authorId, DEMO_CONVERSATION.title, process.env.HAYSTACK_PIPELINE_ID?.trim() ?? ""],
    );
    const { rows: [userMessage] } = await client.query(
      `insert into messages (conversation_id, role, content) values ($1, 'user', $2) returning id`,
      [conversation.id, DEMO_CONVERSATION.question],
    );
    const { rows: [assistantMessage] } = await client.query(
      `insert into messages (conversation_id, reply_to_message_id, role, content, status)
       values ($1, $2, 'assistant', $3, 'complete') returning id`,
      [conversation.id, userMessage.id, DEMO_CONVERSATION.answer],
    );
    for (const [order, source] of DEMO_CONVERSATION.sources.entries()) {
      await client.query(
        `insert into message_sources (message_id, document_id, chunk_id, citation_order, source_metadata)
         values ($1, $2, null, $3, $4)`,
        [assistantMessage.id, source.id, order, JSON.stringify(source)],
      );
    }
    conversationCreated = true;
  }
  await client.query("commit");
  console.log(JSON.stringify({ level: "info", message: "Wiki demo seed complete.", pagesCreated: created, pagesSkipped: skipped, conversationCreated }));
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  console.error(JSON.stringify({ level: "error", message: "Wiki demo seed failed.", error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
