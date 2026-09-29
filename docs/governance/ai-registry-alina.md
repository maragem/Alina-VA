# ALINA AI Register entry (AI Act risk level assessment)

`ALINA_AI_Registry_AI_Act_Risk_Assessment.docx` in this folder is the draft
AI Act risk level assessment questionnaire for ALINA, prepared for the
Corporate IT Governance process (GovIS2 AI Register section). It mirrors the
EU Survey questionnaire used for the "AI Form Filling" prototype
(contribution 1d68e583, 17/10/2025) and adapts every answer and justification
to ALINA's scope, using the Architecture Overview Document V1.0 (18/09/2026)
and this repository's README as sources.

## Result

| Section | Answer | Outcome shown by the questionnaire |
| --- | --- | --- |
| Is it an AI system (Art. 3(1))? | Yes | AI Digital system; AI Act and Guidelines for the management of AI Digital Solutions apply |
| Sole purpose scientific R&D? | No | |
| Military, defence or national security? | No | |
| Uses a GPAI model developed by the Commission? | Yes (GPT@EC) | Exempted from GPAI obligations while no service is provided to external users |
| Services to users outside the Commission? | No | |
| Prohibited practices (Art. 5, 8 questions) | No / Neither | Use-case allowed |
| High-risk, Annex II (now Annex I) products | None | |
| High-risk, Annex III use-cases | None | Explicit reasoning on point 8(a) administration of justice and point 5 essential services |
| Directly interacts with natural persons? | Yes | Transparency risk |
| Generates synthetic text? | Yes | Transparency risk |
| Emotion recognition or biometric categorisation? | No | |
| Deep fakes? | No | |
| Training or fine-tuning of a GPAI model? | No | No GPAI training |

Summary statement: **the AI system has a Transparency Risk.**

## Before submission

The document opens with a table of items the System Owner must confirm:
the GovIS2 name and sequence number, the named System Owner (DIGIT.B1), the
assessor's role, the reading of question 4 for GPT@EC, whether the entry
describes the handed-over prototype (V1.4) or the current codebase, and the
AOD open points on DPO notification, platform retention terms and the formal
AI Act classification position.

## Maintaining the document

The `.docx` is the source of truth. If the answers change (new user
population, corpus classification, functional scope, or industrialisation),
update the document in Word, re-run the questionnaire in EU Survey, and
replace the Ares reference recorded in GovIS2.
