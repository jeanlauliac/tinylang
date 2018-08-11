export void default(string name) {
  return "Hello, ${name}";
}

it "builds the sentence" {
  expect(default("world") == "Hello, world");
}
