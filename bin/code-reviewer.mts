#!/usr/bin/env node
import { runReviewCommand } from '../src/cli/command.mts'

process.exitCode = await runReviewCommand(process.argv.slice(2))
