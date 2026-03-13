const NAMES = ["Alex", "Riley", "Casey", "Jordan", "Morgan", "Taylor", "Sam", "Avery"];
const STREETS = ["Maple", "Oak", "Pine", "Cedar", "Elm", "Sunset", "Ridge"];
const CITIES = ["Portland", "Austin", "Denver", "Seattle", "Chicago", "Phoenix"];

export async function run(ctx, args) {
  const name = NAMES[Math.floor(Math.random() * NAMES.length)];
  const street = STREETS[Math.floor(Math.random() * STREETS.length)];
  const city = CITIES[Math.floor(Math.random() * CITIES.length)];
  const number = Math.floor(100 + Math.random() * 900);
  const phone = `${Math.floor(200 + Math.random() * 800)}-${Math.floor(100 + Math.random() * 900)}-${Math.floor(1000 + Math.random() * 9000)}`;

  ctx.io.println(`${name} ${street}`);
  ctx.io.println(`${number} ${street} St`);
  ctx.io.println(`${city}, USA`);
  ctx.io.println(phone);
}
