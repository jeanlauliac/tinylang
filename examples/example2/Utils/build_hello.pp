export str (str name) {
  return "Hello, ${name}";
}

it "builds the sentence" {
  expect(default("world") == "Hello, world");
}
