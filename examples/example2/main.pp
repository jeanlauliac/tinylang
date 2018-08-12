string FILE_NAME = "hello.txt";

export int16 default(vec<string> args, IO.file stdout) {
  try {
    // It can infer `output` is of native type `IO.file`
    auto output = open_hello(FILE_NAME);
    // `write` is actually the function `uint32 IO.write(IO.file file)`.
    // It looks up the functions in the same namespace as the type.
    output.write(Utils.build_hello("world"));
    // File automatically get closed at the end of the scope.
  } catch (error) {
    switch (error) {
      // switch case allows you to pattern-match.
      case IO.file_exists:
        IO.diag("File ${file_name} already exists!");
        return 1;
      default:
        throw;
    }
  }
  // The 'Math' file is automatically an imported module.
  IO.print(stdout, Math.factorial(5));
  // Shorthand of above.
  stdout.print(Math.factorial(5));
}

// It can infer the return type based on the `return` statement.
auto open_hello(string file_name) {
  // The 'exclusive' identifier is only valid within the scope of the
  // argument.
  IO.file file = IO.open(file_name, exclusive | write);
  // When returning such a value-type we're transfering ownership to the caller.
  return file;
}

it "outputs a file" {
  default([], IO.string_file());
  auto result = IO.open(FILE_NAME, must_exist | read);
  expect(IO.read_entire_file(result) == "Hello, world");
}


// Features:
// * everything is value-type, destruction of resources is deterministic
//   (not just deallocation)
// * switch..case is actually pattern matching and enforce exhaustiveness
// * try..catch provides an `error` automatically typed as a tagged union of
//   all the possible exceptions that could happen
// * default function of the entry module is the entry function
// * ability to write tests in the same files as the functions,
//   with code coverage analysis built-in
// * io is mocked by essence, for ex. cannot write to real filesystem from
//   the integrated test system
// * `auto` keyword to let compiler infer type for locals and function return
//   type specifier
// * no classes, only native type, structs, variants. Shorthand to call a
//   function within the same namespace of a type: `smth.write("bar")` instead
//   of `IO.write(smth, "bar")` if `smth` is an `IO.file` for example
// * lower_case_functions(), UpperCaseNamespaces.smth(), Smth.SOME_CONSTANT.
// * no global state, expect for a diag() function to output stuff in debug
//   mode (ex. no global `printf` function, `cout`, `console.log`)
