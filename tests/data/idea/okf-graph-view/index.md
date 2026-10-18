---
okf_version: "0.2"
type: Idea
name: okf-graph-view
title: OKF graph view
description: A node-and-edge visualisation of the links between concepts and entries; abandoned in favour of backlinks and the file tree.
state: abandoned
tags: [okf, visualisation, links]
generated:
  by: claude-code/ctxman-seed
  at: 2026-10-17T11:10:00Z
---

# OKF graph view

## Problem

It is hard to see how concepts relate across bundles: which entries link to which, and which are orphans.

## Proposal

Render a graph page. Nodes are entries and concepts; edges are intra-bundle links and `ctxman:` links. Filter by dataset, click a node to open it.

## Open questions

* Which layout stays readable beyond a few dozen nodes?
* Does it need a charting dependency, and is that worth it for a local tool?

## Why it was abandoned

* Every detail page already shows the bundle file tree and a "contexts that link here" panel, which answer the common questions (what is in this bundle, who uses it).
* At the current size, a graph conveys little a list does not, and it would add a visualisation dependency and another island to keep accessible and keyboard-navigable.
* The link checks already report broken links and missing targets, which was the other motivation.

Revisit if bundles grow to hundreds of concepts. The link syntax that makes a graph possible is described in [ctxman](ctxman:kb/ctxman).
