# a script exercising the shapes launch cares about
print "side effect"
module m { def main [a] {} }
export def --env "my cmd" [a] {}
def greet [x: list<int> = [1 2], name # who, to greet
] {}
def opt (y?: int, --v(-v)) {}
extern foo [x]
alias q = ls
def main [--verbose name: string, ...rest] {}
