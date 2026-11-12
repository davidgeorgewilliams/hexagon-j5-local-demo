# J5 v30 documentation-derived API contract

Reference checked 12 November 2026 against the [current official API reference](https://docs.hexagonppm.com/r/en-US/j5-API-Reference/Version-30/1050108). The older `j5-Framework-IndustraForm-API-Reference` book URL has moved. This adapter runs entirely against local PostgreSQL data. Contract tests compare the documented transport behaviour; no licensed J5 server was used for interoperability tests.

## Implemented surface

All routes require a valid local session or HTTP Basic authentication. Building grants apply to both authentication methods on every request. Administrator rights are required for asset updates.

| Method and path | Implemented contract | Source |
|---|---|---|
| GET `/restserver/30/industraform/logbook-query/{logbook}` | Legacy JSON array, maximum 1,000 rows; CSV negotiation | [REST](https://docs.hexagonppm.com/r/en-US/j5-API-Reference/Version-30/1050110) |
| GET `/restserver/30/industraform/logbook-query-v2/{logbook}` | `values` and nullable `nextLink`; signed continuation tokens, filters, element attributes, form attributes, CSV, one repeating section per query | [Parameters](https://docs.hexagonppm.com/r/en-US/j5-API-Reference/Version-30/1050114), [response](https://docs.hexagonppm.com/r/en-US/j5-API-Reference/Version-30/1050112), [repeating sections](https://docs.hexagonppm.com/r/en-US/j5-API-Reference/Version-30/1050113) |
| GET `/restserver/30/area_hierarchy/areas` | `responseCode`, `nextLink`, `areas`; root/building hierarchy, 1,000-row pages | [Areas](https://docs.hexagonppm.com/r/en-US/j5-API-Reference/Version-30/1447646) |
| GET `/restserver/30/asset_register/searchAsset/{searchTerm}` | `meta` and up to 100 `matchingAssets`, sorted by asset ID/description | [Asset search](https://docs.hexagonppm.com/r/en-US/j5-API-Reference/Version-30/1444874) |
| PUT `/restserver/30/asset_register/assets` | Single/multiple batches, transaction IDs, staging, atomic final application, repeat-batch idempotency, hierarchy validation and soft deletion | [Asset updates](https://docs.hexagonppm.com/r/en-US/j5-API-Reference/Version-30/1422008) |
| GET `/restserver/30/datapoints/history/get/{id}` | Metadata, timestamp/value records, date bounds, bounded page size, continuation | [Single history](https://docs.hexagonppm.com/r/en-US/j5-API-Reference/Version-30/1421497) |
| GET `/restserver/30/datapoints/history/list/{ids}` | Required date bounds, records keyed by data-point ID, per-point result limit | [Multiple history](https://docs.hexagonppm.com/r/en-US/j5-API-Reference/Version-30/1421498) |
| GET `/restserver/30/datapoints/asset/{assetid}` | Data-point descriptions, labels, input types and units | [Asset data points](https://docs.hexagonppm.com/r/en-US/j5-API-Reference/Version-30/1421499) |
| GET `/ssf/datastore/predefined/{name}` | Area hierarchy, timezones, users/groups and local categories; flat/tree area output and locale label translation | [Datastores](https://docs.hexagonppm.com/r/en-US/j5-API-Reference/Version-30/1477084), [area example](https://docs.hexagonppm.com/r/en-US/j5-API-Reference/Version-30/1497671) |
| GET `/ssf/datastore/database/db_datastore:asset_register` | Asset ID/description lookup with the documented table/column selectors | [Asset datastore](https://docs.hexagonppm.com/r/en-US/j5-API-Reference/Version-30/1477502) |

The supported logbooks are `campus_inspections` (local name), `operator_rounds` (mapped to local inspection records), and `general_logbook` (operational entries).

## Query details

Supported documented parameters: `attribute_names`, `area`, `category`, `status`, `logid`, `form_spec_name`, `from_date_time`, `to_date_time`, `last_modified`, `top`, `pretty`, `query_repeating`, `default_element_attribute`, `display_locale_name`, `display_timezone_name`. Continuations add `skiptoken`. The older `local_area`, `local_from`, `local_to` aliases remain local extensions.

- Dates require RFC3339 timezones. The primary-date lower bound is inclusive; the upper bound is exclusive.
- Area/category paths support descendants; status/log IDs accept comma-separated alternatives.
- Undefined elements return null for value/error/validity attributes and false for `IsDefined`. Unknown attribute suffixes are rejected.
- A repeating query uses ordinary column IDs. It duplicates outer attributes for each row; an empty table contributes no rows. Queries spanning multiple repeating tables are explicitly rejected.
- CSV uses `Accept: text/csv`; continuation is also exposed in the HTTP Link header. Follow the returned URL unchanged.
- `/api/native-contract` lists recognized attributes and current limitations. `/api/openapi.json` documents the local routes.

## Explicit interpretations and unavailable contracts

This is not a complete implementation of every API in the manual. The following distinctions are deliberate:

- Local area IDs are `campus:<building-id>`; record UUIDs, specification hashes, categories and states come from the demo. Section counts, completion and flags map to the local whole-form model.
- The official formula-error prose and example disagree about `DisplayValue`. The adapter follows the example's error-name string. Formula calculations use the independent local engine.
- Participant assignments, native Task elements, signature capture and GPS measurement capture are absent. No assignments or readings are invented. Native task metadata is false; absent metadata is null. Repeating-cell change metadata is not a native per-cell audit model.
- Locale support is bounded; it is not full J5 translation/formatting. Some datastore pages describe data points without a full JSON envelope; those envelopes are local interpretations, not verified contracts. Control-of-Work statuses, isolation points and predefined-message datasets are not implemented.
- Asset callback delivery is rejected explicitly. Soft deletion preserves the historical building association internally so permission checks still protect existing operational records. The adapter requires an existing local building for an active asset.
- The measurement-parent method has a documented path and sample measurement, but no complete response envelope. It is not advertised as supported.
- Native round-definition and round-plan export/import, spreadsheet conversion and bulk plan conversion are unavailable. Their documentation instructs callers to start with exports from a real installation; the complete native JSON schemas are not provided. Local ZIP/XLSX packages are different formats.
- Native query/history pagination currently operates over in-memory result sets. The UI logbook uses SQL filtering/pagination; production scalability for the compatibility adapter has not been established.

## Local extensions

`/api/` provides the demo's write APIs for inspections, transitions, deadlines, releases, repeating tables, formulas, XLSX interchange, permissions, developer execution, operational logbooks and attachments. These are documented local operations, not claimed native J5 endpoints. The API explorer in Developer workspace provides executable read examples and continuation controls.
