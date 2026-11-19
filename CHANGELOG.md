# Changelog

## [0.10.0](https://github.com/ayenisholah/traverse/compare/v0.9.1...v0.10.0) (2026-11-19)


### Features

* **repo-checks:** hold the sandbox router's limits to real values ([a1004f7](https://github.com/ayenisholah/traverse/commit/a1004f7a100e9c923151d8fdef1f8e59bb5879ea))
* **router:** add a read-only sandbox router that returns query plans ([4b61726](https://github.com/ayenisholah/traverse/commit/4b61726d65107644de2bd506129ca973861fe200))
* **router:** serve workspaces through persisted operations ([c5c6933](https://github.com/ayenisholah/traverse/commit/c5c69337af506063c2c0f4092bd8aac6b6aadb62))
* **subgraph-kit:** accept only an access token as a user ([7584fb2](https://github.com/ayenisholah/traverse/commit/7584fb236ffebeadf76075bcba2085cc007b433f))
* **subgraph-kit:** require a verified user for users' own data ([77fa236](https://github.com/ayenisholah/traverse/commit/77fa23685650c216b1b5742c773fb5e355412b40))
* **web:** add package pages and a package.json check ([941c946](https://github.com/ayenisholah/traverse/commit/941c946826becaec16df4060cfeb71bc06dd808d))
* **web:** run generated operations on the public router from a server build ([e90747c](https://github.com/ayenisholah/traverse/commit/e90747ce0151d72987169d7fa644f38034b93f7f))
* **web:** save and reopen workspaces in the server build ([593f1dc](https://github.com/ayenisholah/traverse/commit/593f1dca1e79b14d76594ebf8ef7beb0d741f612))
* **web:** serve package pages and check a package.json's dependencies ([a79ec0b](https://github.com/ayenisholah/traverse/commit/a79ec0b1856ea6a53c7962a2d74895763b394aaf))
* **web:** show a query's route on the operations page ([ff9a99e](https://github.com/ayenisholah/traverse/commit/ff9a99e35c46e4e78610ba91e22337310d39b361))
* **web:** sign in with the user pool in the server build ([3260a61](https://github.com/ayenisholah/traverse/commit/3260a610d66c893aca583e46470d114e3de49d3f))
* **web:** turn a query plan from the sandbox router into a route ([f5b0c55](https://github.com/ayenisholah/traverse/commit/f5b0c552736acdb1d9bd8e46d2e21530a826ce27))
* **workspace:** keep users' saved workspaces in Postgres ([9dc447c](https://github.com/ayenisholah/traverse/commit/9dc447cb1a532dc4c5a1664d0141b890b72bd85b))


### Bug Fixes

* **deps:** raise every zod range past GHSA-mrhx-c7xc-m3w5 ([2e3cd34](https://github.com/ayenisholah/traverse/commit/2e3cd34a4cecd325506056be3bb4263e92b071bb))
* **router:** hold the access log list to exactly the hidden names ([df3b651](https://github.com/ayenisholah/traverse/commit/df3b65167159c6a55af2c5e807715dae11372d7d))
* **router:** hold the public router's config to an allow-list ([5fc9644](https://github.com/ayenisholah/traverse/commit/5fc964444d83efb7bd9293b827eedfc59f2706a2))
* **router:** hold the sandbox config to an allow-list and keep GET operations out of its log ([1b85982](https://github.com/ayenisholah/traverse/commit/1b85982a1339a7ea9cc027fbb2ab04b786d7f120))
* **web:** cap the API's request body and pass on only the router's own refusals ([f25ff4f](https://github.com/ayenisholah/traverse/commit/f25ff4fc5aa1a93ba4b0bcbdaa7fb3eb423f6a09))
* **web:** never show a check as clean when a source didn't answer ([38aea6a](https://github.com/ayenisholah/traverse/commit/38aea6a15caf3cd1c9e08e47f8800d157dde7109))
* **web:** refuse cross-site mutations, and bound saves on their own ([2d39a0f](https://github.com/ayenisholah/traverse/commit/2d39a0f3adbbc2238cc44a7a8aac3dabef9a057a))
* **web:** say an operation can't run, since the server refuses writes itself ([5dfb14b](https://github.com/ayenisholah/traverse/commit/5dfb14be9d7e3cc1441648cd662062b9e194c83b))
* **web:** validate the router's answer and keep server code out of the browser ([3fdf011](https://github.com/ayenisholah/traverse/commit/3fdf01188cda87ac28df4ea6c8d71ed2522129fe))
* **workspace:** refuse a database URL pg would read differently, and NUL text ([cd143a9](https://github.com/ayenisholah/traverse/commit/cd143a9e4dc052fe32db252674773908b1a02c0f))

## [0.9.1](https://github.com/ayenisholah/traverse/compare/v0.9.0...v0.9.1) (2026-11-09)


### Bug Fixes

* **subgraph-kit:** cap Retry-After at a minute ([a89a3fa](https://github.com/ayenisholah/traverse/commit/a89a3fa283505e66f0dd92ea834c892ca73f7fe4))
* **subgraph-kit:** share each source's queue fairly between requests ([a740334](https://github.com/ayenisholah/traverse/commit/a7403344243f7ed5f5741cfae55058cfd6398c33))

## [0.9.0](https://github.com/ayenisholah/traverse/compare/v0.8.0...v0.9.0) (2026-11-08)


### Features

* **repo-checks:** check the public router config and environment ([850b3ea](https://github.com/ayenisholah/traverse/commit/850b3ea4c747a7707974d73c8826f099920c7606))
* **router:** compose the subgraphs behind a hardened public router config ([437c1f6](https://github.com/ayenisholah/traverse/commit/437c1f6ac02499ddfa8bc1a223b1097464353543))

## [0.8.0](https://github.com/ayenisholah/traverse/compare/v0.7.1...v0.8.0) (2026-11-08)


### Features

* **advisories:** serve osv advisories in the graph ([68b079c](https://github.com/ayenisholah/traverse/commit/68b079c7653d45f25094ae39db083cc732a3c331))
* **packages:** serve npm data in the graph ([bca690a](https://github.com/ayenisholah/traverse/commit/bca690a0123ff59c81b01f8e4f02471c8cb29284))
* **repo-checks:** add personal data scrubbing for recordings ([d3febe0](https://github.com/ayenisholah/traverse/commit/d3febe0d0ed8e9c9d36a18b29ff498c5f7142816))
* **repo-checks:** remove contact details from recordings ([d5d3125](https://github.com/ayenisholah/traverse/commit/d5d3125559324a6b2e50105c6a8bbdd16e08195b))
* **repo-checks:** scrub ip addresses from recordings ([711ae65](https://github.com/ayenisholah/traverse/commit/711ae6566cf1faae780e8ce9a94a39046cfcfd8e))
* **repositories:** serve github data in the graph ([54ea50c](https://github.com/ayenisholah/traverse/commit/54ea50c14f6f9b590fc5939c6ccea4ee6949556c))
* **subgraph-kit:** add a bounded upstream fetch ([f73514a](https://github.com/ayenisholah/traverse/commit/f73514a924f841f3aac898264c6d5934ca45192b))
* **subgraph-kit:** add caching, retries and limits for upstream calls ([8650674](https://github.com/ayenisholah/traverse/commit/86506747fc4725437981c39e9eb5ca8bf4ba5ef9))
* **subgraph-kit:** add the shared subgraph server ([a9dda59](https://github.com/ayenisholah/traverse/commit/a9dda595a80e86def0fec7adab972105325ac66b))
* **subgraph-kit:** let a 404 count as a source failure ([ddcff3f](https://github.com/ayenisholah/traverse/commit/ddcff3f8f68e73879f18490d6f91254a9452654b))
* **subgraph-kit:** share formats, endpoint checks and test helpers ([63e924b](https://github.com/ayenisholah/traverse/commit/63e924b7682f452f440b105b2f137d9f8d4700ab))


### Bug Fixes

* **packages:** resolve the code scanning findings ([9b31f6e](https://github.com/ayenisholah/traverse/commit/9b31f6e75ed52f907139b5e72acaa489a76096fb))

## [0.7.1](https://github.com/ayenisholah/traverse/compare/v0.7.0...v0.7.1) (2026-11-06)


### Continuous Integration

* skip the package cache when publishing ([c7f44de](https://github.com/ayenisholah/traverse/commit/c7f44deca5b416a4f2169926d31e31da127549f3))

## [0.7.0](https://github.com/ayenisholah/traverse/compare/v0.6.0...v0.7.0) (2026-11-06)


### Features

* **cli:** add the traverse check and comment commands ([1faf86f](https://github.com/ayenisholah/traverse/commit/1faf86faea95377fdc36066ea2e3df27ab691b88))
* **graph-core:** collect operations and fragments across files ([b017c00](https://github.com/ayenisholah/traverse/commit/b017c00da5f458c0619a1556263545df7b20727a))

## [0.6.0](https://github.com/ayenisholah/traverse/compare/v0.5.0...v0.6.0) (2026-11-06)


### Features

* **graph-core:** split operations and report each error once ([9c70593](https://github.com/ayenisholah/traverse/commit/9c7059379b7b94058da517b678c686b0b931b823))
* **web:** add the impact check ([4f6a9bc](https://github.com/ayenisholah/traverse/commit/4f6a9bcc5aa3b3e377ac2156f350802bd0475d6d))


### Bug Fixes

* **web:** ignore worker messages that name an origin ([fde8127](https://github.com/ayenisholah/traverse/commit/fde8127483b9315fc12cb2b3477653d709c4f640))

## [0.5.0](https://github.com/ayenisholah/traverse/compare/v0.4.0...v0.5.0) (2026-11-06)


### Features

* **graph-core:** add the graph map model ([863531e](https://github.com/ayenisholah/traverse/commit/863531eaea0b4dd13db2cf289c004f7321109932))
* **web:** add the searchable graph map ([81c2bf1](https://github.com/ayenisholah/traverse/commit/81c2bf17d83b3ab77c86a3396496ee414975094e))

## [0.4.0](https://github.com/ayenisholah/traverse/compare/v0.3.0...v0.4.0) (2026-11-06)


### Features

* **design-tokens:** add the frox scale as semantic tokens ([136231a](https://github.com/ayenisholah/traverse/commit/136231a9d843429f4b57334289e9c4abb13bfaca))
* **repo-checks:** reject px and raw colours in app styles ([09d287d](https://github.com/ayenisholah/traverse/commit/09d287db0af5272c2d8b1825f2efef14bb8ea21b))

## [0.3.0](https://github.com/ayenisholah/traverse/compare/v0.2.0...v0.3.0) (2026-11-06)


### Features

* **graph-core:** add composition, field ownership and impact analysis ([401451d](https://github.com/ayenisholah/traverse/commit/401451d5c683bdd801504d234e709b4a613f9452))

## [0.2.0](https://github.com/ayenisholah/traverse/compare/v0.1.0...v0.2.0) (2026-11-06)


### Features

* **repo-checks:** add hygiene and traceability checks ([53089fa](https://github.com/ayenisholah/traverse/commit/53089facff41d6744e8fa6436061479bda171411))
* **repo-checks:** add the progress log check ([93e9c07](https://github.com/ayenisholah/traverse/commit/93e9c07969f0d7cdb3cf54d18c4a25fd823808b8))
