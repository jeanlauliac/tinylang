string file_name = "hello.txt";

export int16 default(vec<string> args) {
  try {
    // The 'exclusive' identifier is only valid within the scope of the
    // argument.
    IO.file output(file_name, exclusive | write);
    output.write(Utils.build_hello("world"));
    // File automatically get closed at the end of the scope.
  } catch (error) {
    switch (error) {
      // switch case allows you to pattern-match.
      case IO.file_exists:
        print("File ${file_name} already exists!");
        return 1;
      default:
        throw;
    }
  }
  // The 'Math' file is automatically an imported module.
  print(Math.factorial(5));
}

it "outputs a file" {
  main([]);
  IO.file result(File_name, must_exist | read);
  expect(IO.read_entire_file(result) == "Hello, world");
}


// Features:
// * everything is value-type, destruction of resources is deterministic
// * switch..case is actually pattern matching and enforce exhaustiveness
// * try..catch provides an `error` automatically typed as a tagged union of
//   all the possible exceptions that could happen
// * function called main() is the entry point
// * io is mocked by essence, for ex. cannot write to real filesystem from
//   integrated tests
