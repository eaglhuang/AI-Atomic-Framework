import { main } from './validate-prompt-scoped-next/main.ts';

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
