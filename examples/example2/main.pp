string FILE_NAME = "hello.txt";

export u16 (vec<str> args, IO.Access io) {
  try {
    // It can infer `output` is of native type `IO.file`
    auto output = io.fs.open_hello(FILE_NAME);
    // `write` is actually the function `u32 IO.write(IO.file file)`.
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
auto open_hello(IO.Filesystem fs, str file_name) {
  // The 'exclusive' identifier is only valid within the scope of the
  // argument.
  IO.file file = fs.open(file_name, exclusive | write_only);
  // When returning such a value-type we're transfering ownership to the caller.
  return file;
}

describe("main") {
  // namespace destructuring
  using {open} = IO;
  // aliases
  using open_file = IO.open;

  it("outputs a file") {
    default([], IO.string_file());
    auto result = IO.open(FILE_NAME, must_exist | read);
    expect(IO.read_entire_file(result) == "Hello, world");

    // manual release of an owned object, if we need to do more stuff afterwards
    release result;
  }
}

// Structure syntax.
struct Location {
  str file_path,
  u32 line,
  u32 column,
}

// variants-style enum
enum Expression_type {
  sum(struct {Expression left, Expression right}),
  literal(u32),
}

struct Expression {
  Expression_type type,
  Location location,
}

void smth() {
  // Structure initializer syntax
  Location cur_loc = {
    file_path: "foo.js",
    line: 23,
    column: 12,
  };
  ++cur_loc.line;

  // destructuring
  Location {line} = cur_loc;
  auto {column} = cur_loc;

  // enums/variants
  Expression exp = {
    value: literal(45),
    location: cur_loc,
  }
  auto var = Expression_type.sum(exp, {
    value: literal(10),
    location: cur_loc,
  });

  // Dictionnary initializer syntax
  dict<str, u16> smth = [
    "foo": 9765,
    "bar": 123,
  ];
}

void print(Expression exp) {
  // matching variants
  switch (exp.value) {
  case literal(num):
    IO.print(num.to_string());
    break;
  case sum({left, right}):
    left.print();
    IO.print(' + ');
    right.print();
    break;
  }
}

// normal enum
enum File_modes { read_only, read_write, write_only };


void refs_example() {
  // Initialise a vector.
  vec<u16> foo = [3, 6, 9];

  // This does a copy of the vector. (But, compiler might decide just do
  // (1) a reference if vectors are not mutated later or (2) a move if
  // "foo" doesn't get accessed anymore later.
  vec<u16> glo = foo;

  // Creates a reference to "foo". "foo" and "bar" are aliased to the same
  // vector. This is safe as "bar" lifetime can't exceeds the one of "foo"
  // since they are in the same scope. Operator "^" declares a reference.
  // This is not part of the type, but part of the local's declaration.
  // Indeed "vec<u26^>" is not a valid type, for example (TODO: why not?).
  // Operator "&" makes it explicit we want to get a ref. Useful when calling
  // functions taking refs.
  vec<u16> ^bar = &foo;

  // These are equivalent, push in "foo" (and "bar"). For both case, because
  // "push(vec<T> ^target, T item)" takes a reference as argument, we have
  // to use operator "&" so that it's clear we give it the right to mutate our
  // local values.
  push(&foo, 10);
  push(&bar, 10);

  // Same, shorthand notation. In that case `foo` is automatically taken as ref.
  foo.push(10);
  bar.push(10);

  // These are equivalent, references cannot be "relinked" to another variable,
  // "=" just assign the aliased variable
  foo = [1, 2];
  bar = [1, 2];

  {
    // Get a reference to a specific item. This causes "foo" to become immutable,
    // because we cannot the reference to get invalidated.
    u16 ^itemref = &foo[0];

    // Would be illegal, causing a compilation error.
    // foo.push(20);
  }

  // This is legal again, since "itemref" is not in scope anymore.
  foo.push(20);

  // We don't read from `foo` after pushing something, so the push is useless.
  // This should generate an error here.
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
// * because of language structure, and no global state, we can identify
//   "pure" function and hot-reload them (ex. in the browser)


// * when passing an object to a function, the comp determines what to do:
//     either we 'move' the object: no allocation necessary, but we cannot use
//        the object later in the function. This is the default for most cases
//     or we 'lend' the object if it's a read-only arg, we can still use the
//        object later
//     or we pass it by reference, we can still use the object later, but
//        callee must explicitely mark as a 'ref' (operator & ?)
//     or we need to clone() the object to allocate a copy.

// basically when calling a sub-function with an argument A, that function
// may either just peek at the object / borrow it, or it may need to get
// ownership of it (to put it in its own storage, modify it, etc.) If it's the
// latter, we have 2 choices: either we need to clone() (in which case we
// don't even need our own ownership of that object), or we need to give
// up ownership, meaning we cannot use that object in the following statements
// of the function.


// * no side-effect without authorisation. A function/package need to get
//   permission from callee before running arbitrary sub-processes, access
//   network, write files, etc.

// * if local variable it not initialized at declaration, analyser verifies all
//   code paths initialize it before it is accessed the first time (or passed as
//   argument?)


// Custom dispose() functions? If specified, then restrictions apply on type
//
// void dispose(IO.file target) {
//   IO.close_fd(target.fd);
// }
