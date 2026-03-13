const FORTUNES = [
  "Fortune favors the bold.",
  "Simplicity is the ultimate sophistication.",
  "You miss 100% of the shots you don't take.",
  "Talk is cheap. Show me the code.",
  "The quieter you become, the more you can hear.",
];

export async function run(ctx) {
  const pick = FORTUNES[Math.floor(Math.random() * FORTUNES.length)];
  ctx.io.println(pick);
}
