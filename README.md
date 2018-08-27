# Tiny

*Tiny* is a little language that compiles to JavaScript.
Here's an "hello world" implementation:

```cpp
// main.tn
export u8 (vec<str> args) {
  IO.print("Hello, world");
  return 0;
}
```
