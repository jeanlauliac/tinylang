export int32 factorial(int32 n) {
  if (n == 0) return 1;
  return factorial(n - 1) * n;
}

it "works for the base case" {
  expect(factorial(0)).to_equal(1);
}

it "works for case 5" {
  expect(factorial(5)).to_equal(120);
}
