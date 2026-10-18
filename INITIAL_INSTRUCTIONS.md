# overview

ctxman is short for context manager

the purpose of ctxman is to act as a few things which relate to agentic AI coding:

- local repository of information that spans many formats
- tools and data organize that information
- tools to define ideas, tasks, bugfixes, features and whole projects I want to build
- datasets via astro content collections for the ideas, tasks, bugfixes, features, and data which organizes and curates the modeled datasets


# technology

- MUST use playwright for integration testing of the project
- MUST use vitest for headless unit testing of the project
- MUST use TypeScript for all code
- MUST use TypeScript 7+ for tooling to use native go tsc etc
- MUST use NodeJS 24 and run TypeScript DIRECTLY for scripts that are writtin in TS, never transpile first
- MUST use NodeJS 24 compatible TypeScript for scripts that run and do local work with fs, etc.
- MUST use npm package astro 7.4.0
- MUST use astro content collections to manage the various datasets
- MUST use react with astro
- MUST use react-aria-components (RAC) for UI kit
- MUST use vanilla CSS for styling the RAC UI kit
- MUST use nanostores + @nanostores/react for framework agnostic browser state
- MUST use URL params for full page state so that deep linking works for the current UI state all the time and browser nav works with forward/back, DO NOT end up with deep in-memory only 
- MUST use oxfmt and oxlint for formatting and linting, use the .oxfmtrc.json and .oxlintrc.json files in place in the repo root, they may need adjustment, keep them up to date with the repo structure as it evolves
- MUST create an AGENTS.md in the project root and maintain it as the project evolves with concise, precise and accurate instructions on what the repo contains, what tech must be used, what rules to adhere to, and how to keep all docs and AGENTS.md up to date efficiently for ongoing work, features, bugfixes, maintenance, etc.
- MUST ensure that any OS level native scripts that are created to run as action/api/function routes MUST be cross-platform and work on macOS, Linux and Windows.  Assume NodeJS 24+ is available so all these scripts should be TypeScript using built-in NodeJS platform APIs like `node:fs` etc and run via the default available node interpreter when needed


# features

- an astro site
- runs on node backend with API routes / functions, NOT a static site
- runs locally only, it will never be published to a hosting platform
- is able to run local native OS processes/scripts
- define various kinds of datasets:
- npm script to help template out each kind of dataset to add a new one, like `npm add:idea`
- self checks for compliance that all datasets are compliant with astro content collections (astro check should help with this) and okf bundle compliance, and markdown relative remain valid within an okf bundle
- a navigable set of pages rendered for the different datasets
- a global fuzzy search using fuse.js, via a custom full screen search widget and UI/UX created from RAC components.  should have ability to search across all the datasets and have simple ways to filter down on different datasets only.  i want all markdown content in the dataset okf bundles indexed, and i want the data models for the non-markdown okf datasets to also have searchable records but represented by their data fields
- a "context forge" tool which lets the user have a convenient UX to discover items from our datasets and then link them to a context dataset item.  the idea is we can build reusable context dataset items which are data pointers to deeper contextual information, but do not themselves vendor the data into the "context" item itself so it's an evergreen pointer to other dataset items that can evolve over time.  this is the key item that ctxman will be using as the main vessel for how to provide context to a given ai agentic coding session
- a "context inflate" tool which can select N context items, take in markdown from the user for instructions, and prepare all the linked items from all the selected contexts for consumption by an agentic coding harness.  we want to support either claude code or codex. DO NOT build this yet. but build everything else.


# datasets

has the following datasets, all datasets entries minimally need a required unique name (can be used as the content collection slug) and description

- kb - these are okf compliant bundles of markdown vendored directly into this repo.  its purpose is to be information about some existing thing, kb is knowledge base
  - no lifecycle
  - has metadata on freshness (last modified date)
- rca - these are okf compliant bundles of markdown vendored directly into this repo.  its purpose is to be a root cause analysis of a prior incident or solved problem for reference in the future to avoid repeating issues or to help solve future problems with similar overlapping causes
  - no lifecycle
  - has metadata on freshness (last modified date)
- idea - this is okf compliant bundles of markdown vendored directly into this repo
  - state lifecycle enum: [pending, in progress, complete, abandoned]
  - has metadata on freshness (last modified date)
- task - this is okf compliant bundles of markdown vendored directly into this repo
  - state lifecycle enum: [pending, in progress, complete, wont do]
  - has metadata on freshness (last modified date)
- bug - this is okf compliant bundles of markdown vendored directly into this repo
  - state lifecycle enum: [pending, in progress, fixed, wont fix]
  - has metadata on freshness (last modified date)
- feature - this is okf compliant bundles of markdown vendored directly into this repo
  - state lifecycle enum: [pending, in progress, complete, wont do]
  - has metadata on freshness (last modified date)
- project - this is okf compliant bundles of markdown vendored directly into this repo.  this is meant to be a large scope of work that may encompass and reference many ideas, tasks, features and info
  - state lifecycle enum: [pending, in progress, complete, wont do]
  - has metadata on freshness (last modified date)
- skill - this is an https://agentskills.io/llms.txt compliant agentic skill folder
- reference - this is NOT a local data okf bundle.  it's data which refers to something external to this repo, like a local folder of some git repo, or a remote git URI, or a webpage for docs, etc.
  - must have a "type" field for typescript type discrimination to support different fields for different kinds of references
  - model type variants which each have their own set of fields:
    - local repo - a git repository on the local machine
      - fields
        - name [string]
        - description [string]
        - path [string] - the path on this system to the repo root
        - subpath [string] - the repo relative path to the sub folder of relevant information
        - owner [enum: (me, not me)]
    - remote repo - a git repository refere
      - fields
        - name [string]
        - description [string]
        - uri [string]
        - subpath [string] - the repo relative path to the sub folder of relevant information
        - owner [enum: (me, not me)]
    - remote skill - a remote git repo which contains a https://agentskills.io/llms.txt compliant agentic skill folder
      - fields
        - name [string]
        - description [string]
        - uri [string]
        - subpath [string] - the repo relative path to the skill folder, can be empty string or null/undefined to represent the repo root
        - owner [enum: (me, not me)]
- context - this is a data model that is meant to aggergate links to our other data sets to act as the "thing" which represents what we want to provide to agentic AI coding agents.  it should be able to track references to other dataset slugs AND accept some optional markdown per linked item (the purpose of the markdown would be to provide additional context to the AI agent consuming this linked item to perhaps narrow the scope it should care about or provide helpful guidance on what the data is meant to be used for in this particular context, etc.)
  - the datasets to allow linking to:
    - kb
    - rca
    - idea
    - task
    - bug
    - feature
    - skill
    - reference
    - project


# additional instructions 1

once done with the iniitial design and impl work, then using a sonnet-5.5 / high subagent add the following initial changes

- make remote skill support a HTTPS URI to a tarball ending in .tar.gz or .zip file in additional to a git repo URI

add the following data items as our first entries

existing REMOTE repo references:

- git@github.com:meow-sci/catcom.git - owned: yes, name: catcom, description: ksa mod for in-game scripting using lua or typescript
- git@github.com:meow-sci/unscience.git - owned: yes, name: unscience, description: ksa mod for a kitchen sink of various ways to hack the game
- git@github.com:meow-sci/purrtty.git - owned: yes, name: purrtty, description: ksa mod for in-game terminal emulator
- git@github.com:meow-sci/gatOS.git - owned: yes, name: gatOS, description: ksa mod for a linux vm integrated with ksa game data and control
- git@github.com:meow-sci/blasto.git - owned: yes, name: blasto, description: ksa mod for ground landing vfx
- git@github.com:meow-sci/flexo.git - owned: yes, name: flexo, description: a static site tool which can build ksa parts and subpart asset mods


existing REMOTE skill references:

- https://meow.science.fail/ksa-coffer/downloads/ksa-modding-latest.tar.gz

