{ pkgs ? import <nixpkgs> {} }:
pkgs.mkShell {
  packages = with pkgs; [
    nodejs_24
    chromium
    curl
    git
    jq
  ];
  shellHook = ''
    export PLAYWRIGHT_BROWSERS_PATH=0
    echo "DiceCloud LoV exporter shell ready (Node $(node --version))"
  '';
}
