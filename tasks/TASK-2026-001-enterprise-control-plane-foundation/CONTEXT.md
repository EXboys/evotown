# Context: Enterprise control plane spec and task foundation

## Repository context

Evotown is a standalone repository under `github.com/EXboys/evotown`, while this local checkout lives under the broader `skillLite` workspace. Evotown should not inherit SkillLite-specific implementation assumptions by default.

## Existing assets

- `README.md`: primary project entry point.
- `docs/en/EVOTOWN-ENGINE-INGEST-V0.1.md`: external engine ingest API draft.
- `docs/zh-CN/EVOTOWN-ENGINE-INGEST-V0.1.md`: Chinese ingest API draft.
- `docs/openapi/evotown-engine-ingest-v0.1.yaml`: OpenAPI draft.
- `docs/en/ENTERPRISE_CONTROL_PLANE_PRODUCT_SPEC.md`: readable English planning doc.
- `docs/zh-CN/ENTERPRISE_CONTROL_PLANE_PRODUCT_SPEC.md`: readable Chinese planning doc.
- `spec/`: newly introduced source of product / architecture direction.

## Boundaries

- Specs are planning and decision documents, not runtime configuration.
- Task files are execution records, not public product documentation.
- No code behavior changes are part of this task.

## Compatibility notes

- Existing Arena / task history / chronicle pages remain conceptually valid.
- Existing ingest API remains v0.1 and is not changed by this task.
- SkillLite remains one optional connected runtime, not a required dependency.

