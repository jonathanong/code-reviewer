#!/usr/bin/env node
import { runFinalReviewCommand } from '../src/cli/command.mts'

process.exitCode = await runFinalReviewCommand(process.argv.slice(2))
