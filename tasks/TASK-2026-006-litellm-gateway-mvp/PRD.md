# PRD: LiteLLM-backed gateway MVP

## Problem

Enterprise operators need a centralized API entry point for all agent model traffic so conversations, cost, frequency, risk events, and ownership can be monitored across independently deployed agent frameworks.

## Goals

- Let agents use an OpenAI-compatible Evotown endpoint.
- Keep provider routing and model compatibility delegated to LiteLLM.
- Preserve Evotown as the enterprise control plane for attribution, audit, policy, and UI.

## Non-goals

- Streaming support in the first MVP.
- Full LiteLLM virtual-key management replacement.
- Deep policy enforcement beyond request attribution and persistence.

## Requirements

- Agents authenticate to Evotown with bearer gateway keys.
- Evotown forwards non-streaming chat completion requests to LiteLLM.
- Evotown records request summaries with agent/team/engine/conversation metadata.
- Console surfaces summary usage and conversations.
