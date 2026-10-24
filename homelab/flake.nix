{
  description = "Home lab machines declared as code";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";
    nixpkgs2605.url = "github:NixOS/nixpkgs/nixos-26.05";

    disko = {
      url = "github:nix-community/disko";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    nixos-anywhere = {
      url = "github:nix-community/nixos-anywhere";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      self,
      disko,
      nixos-anywhere,
      nixpkgs,
      nixpkgs2605,
    }:
    let
      supportedSystems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = nixpkgs.lib.genAttrs supportedSystems;
      pkgsFor = system: import nixpkgs { inherit system; };
    in
    {
      lib.flakeContract = {
        version = 1;
        inherit supportedSystems;
        lockOwner = "homelab";
      };

      devShells = forAllSystems (
        system:
        let
          pkgs = pkgsFor system;
        in
        {
          default = pkgs.mkShellNoCC {
            packages = [ pkgs.nixfmt-rfc-style ];
          };
        }
      );

      checks = forAllSystems (
        system:
        let
          pkgs = pkgsFor system;
        in
        {
          flake-contract =
            assert self.lib.flakeContract.version == 1;
            assert builtins.elem system self.lib.flakeContract.supportedSystems;
            assert builtins.hasAttr system self.devShells;
            assert self.devShells.${system} ? default;
            assert builtins.hasAttr system self.formatter;
            assert builtins.hasAttr "configuration-revision" self.nixosModules;
            assert self.nixosConfigurations ? asus-desktop;
            assert self.nixosConfigurations ? remote-development;
            assert self.nixosConfigurations ? vector-development;
            pkgs.runCommand "homelab-flake-contract-v1" { } ''
              test ${toString self.lib.flakeContract.version} = 1
              touch "$out"
            '';
        }
      );

      formatter = forAllSystems (system: (pkgsFor system).nixfmt-rfc-style);

      packages.x86_64-linux.nixos-anywhere = nixos-anywhere.packages.x86_64-linux.default;

      apps.x86_64-linux.nixos-anywhere = {
        type = "app";
        program = "${self.packages.x86_64-linux.nixos-anywhere}/bin/nixos-anywhere";
        meta.description = "Install a NixOS configuration on a remote host";
      };

      nixosModules.configuration-revision = {
        system.configurationRevision = if self ? rev then self.rev else self.dirtyRev or null;
      };

      nixosConfigurations.asus-desktop = nixpkgs.lib.nixosSystem {
        system = "x86_64-linux";
        modules = [
          ./hosts/asus-desktop
          self.nixosModules.configuration-revision
        ];
      };

      nixosConfigurations.remote-development = nixpkgs.lib.nixosSystem {
        system = "x86_64-linux";
        modules = [
          disko.nixosModules.disko
          ./hosts/remote-development
          self.nixosModules.configuration-revision
        ];
      };

      nixosConfigurations.vector-development = nixpkgs2605.lib.nixosSystem {
        system = "x86_64-linux";
        modules = [
          disko.nixosModules.disko
          ./hosts/vector-development
          self.nixosModules.configuration-revision
        ];
      };
    };
}
