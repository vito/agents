# Vetting dang-160-clean

This case has no known issues, so there is nothing to vet: it measures noise.
The range is vito/dang#160 (6e8ca56..338e5fd), merged 2026-06-30. Through
2026-10-17 no later commit touched pkg/querybuilder/querybuilder.go or
pkg/dang/builtins.go, and the later commits to pkg/dang/eval.go (scalar bodies,
Regexp, visibility, @expectedType loads) do not fix number or argument
conversion. A good review says the change is fine and raises little; the
sound items in case.json are things such a review might wrongly call broken.

If a later fix ever attributes a bug to this change, add it as an issue here
with `vetted: real` and cite the fix.
