#!/usr/bin/env node
import { plannedCliCommands } from './index.ts';

const commandList = plannedCliCommands.map((command) => command.commandName).join(', ');
console.log(`ATM CLI skeleton. Planned commands: ${commandList}`);