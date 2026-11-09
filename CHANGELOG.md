# Changelog

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
