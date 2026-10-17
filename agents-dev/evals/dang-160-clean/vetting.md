# Vetting dang-160-clean

This case has no known issues, only sound items to vet: it measures noise.
The range is vito/dang#160 (6e8ca56..338e5fd), merged 2026-06-30. Through
2026-10-17 no later commit touched pkg/querybuilder/querybuilder.go or
pkg/dang/builtins.go, and the later commits to pkg/dang/eval.go (scalar bodies,
Regexp, visibility, @expectedType loads) do not fix number or argument
conversion. A good review says the change is fine and raises little; the
sound items below are things such a review might wrongly call broken.

If a later fix ever attributes a bug to this change, add it as an issue here
with `vetted: real` and cite the fix.

## Sound items

Found correct when the case was compiled. Mark each `sound` (it holds: a
finding calling it broken is false) or `dismiss` (it does not hold, or is no
trap); left blank, a finding that contradicts it keeps the judge's value unless
the judge rated it false or a speed bump.

### use-number-decode
vetted:
Execute decodes the response's data (and every unpack) with UseNumber, so
integers stay exact; the declared GraphQL type decides Int vs Float.

### float-and-map-arguments
vetted:
dangValueToGo now serializes FloatValue and MapValue (recursively), so a Float
result can be passed back as a Float argument.

### untyped-number-fallback
vetted:
ToValue's json.Number case is the untyped fallback: an integral number that
fits an int becomes an Int, anything else a Float.
