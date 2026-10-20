{
  description = "Non-production Nix build, OCI image, and NixOS host boundary spike";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";

  outputs =
    { self, nixpkgs }:
    let
      inherit (nixpkgs) lib;
      supportedSystems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = lib.genAttrs supportedSystems;
      pkgsFor = system: import nixpkgs { inherit system; };

      packageSetFor =
        system:
        let
          pkgs = pkgsFor system;

          typescriptService = pkgs.stdenvNoCC.mkDerivation {
            pname = "pep-typescript-service";
            version = "0.1.0";
            src = ./services/typescript;

            nativeBuildInputs = [
              pkgs.esbuild
              pkgs.makeWrapper
              pkgs.nodejs_24
            ];

            buildPhase = ''
              runHook preBuild
              mkdir -p dist
              esbuild src/server.ts \
                --bundle \
                --format=esm \
                --platform=node \
                --target=node24 \
                --outfile=dist/server.mjs
              node --check dist/server.mjs
              runHook postBuild
            '';

            installPhase = ''
              runHook preInstall
              mkdir -p "$out/bin" "$out/lib/pep-typescript-service"
              install -m 0444 dist/server.mjs "$out/lib/pep-typescript-service/server.mjs"
              makeWrapper ${pkgs.nodejs_24}/bin/node "$out/bin/pep-typescript-service" \
                --add-flags "$out/lib/pep-typescript-service/server.mjs"
              runHook postInstall
            '';
          };

          pythonService = pkgs.python3Packages.buildPythonApplication {
            pname = "pep-python-service";
            version = "0.1.0";
            format = "setuptools";
            src = ./services/python;

            pythonImportsCheck = [ "pep_health" ];
            doCheck = true;
            preCheck = ''
              export PYTHONPATH="$PWD/src"
            '';
            checkPhase = ''
              runHook preCheck
              python -m unittest discover -s tests -v
              runHook postCheck
            '';
          };
        in
        {
          default = typescriptService;
          python-service = pythonService;
          typescript-service = typescriptService;
        }
        // lib.optionalAttrs pkgs.stdenv.isLinux {
          typescript-image = pkgs.dockerTools.buildLayeredImage {
            name = "pep-nix-spike";
            tag = "nix";
            created = "1970-01-01T00:00:01Z";
            maxLayers = 100;
            contents = [ typescriptService ];
            config = {
              Cmd = [ "${typescriptService}/bin/pep-typescript-service" ];
              Env = [ "PORT=8080" ];
              ExposedPorts."8080/tcp" = { };
              Labels = {
                "org.opencontainers.image.description" = "dockerTools boundary spike image";
                "org.opencontainers.image.source" = "https://github.com/Robbie-Palmer/hq";
              };
              User = "65532:65532";
            };
          };
        };

      packageSets = forAllSystems packageSetFor;
    in
    {
      packages = packageSets;

      apps = forAllSystems (system: {
        python-service = {
          type = "app";
          program = "${packageSets.${system}.python-service}/bin/pep-python-service";
          meta.description = "Run the prototype Python service";
        };
        typescript-service = {
          type = "app";
          program = "${packageSets.${system}.typescript-service}/bin/pep-typescript-service";
          meta.description = "Run the prototype TypeScript service";
        };
      });

      checks = forAllSystems (
        system:
        let
          pkgs = pkgsFor system;
          packages = packageSets.${system};
          smokeCheck =
            {
              executable,
              expected,
              name,
              package,
              port,
            }:
            pkgs.runCommand name { nativeBuildInputs = [ pkgs.curl ]; } ''
              export HOST=127.0.0.1
              export PORT=${toString port}
              ${package}/bin/${executable} >service.log 2>&1 &
              service_pid=$!
              trap 'kill "$service_pid" >/dev/null 2>&1 || true' EXIT

              for _ in $(seq 1 30); do
                if curl --fail --silent "http://127.0.0.1:${toString port}/health" >response.json; then
                  break
                fi
                sleep 0.1
              done

              grep --fixed-strings '${expected}' response.json
              touch "$out"
            '';
        in
        {
          python-service = packages.python-service;
          python-smoke = smokeCheck {
            executable = "pep-python-service";
            expected = "\"service\": \"python\"";
            name = "pep-python-service-smoke";
            package = packages.python-service;
            port = 18081;
          };
          typescript-service = packages.typescript-service;
          typescript-smoke = smokeCheck {
            executable = "pep-typescript-service";
            expected = "\"service\":\"typescript\"";
            name = "pep-typescript-service-smoke";
            package = packages.typescript-service;
            port = 18080;
          };
        }
        // lib.optionalAttrs (system == "x86_64-linux") {
          nixos-module =
            let
              evaluated = {
                dynamicUser =
                  self.nixosConfigurations.prototype.config.systemd.services.pep-health.serviceConfig.DynamicUser;
                execStart =
                  self.nixosConfigurations.prototype.config.systemd.services.pep-health.serviceConfig.ExecStart;
                port = self.nixosConfigurations.prototype.config.systemd.services.pep-health.environment.PORT;
              };
            in
            pkgs.writeText "pep-health-module-evaluation.json" (builtins.toJSON evaluated);
        }
      );

      devShells = forAllSystems (
        system:
        let
          pkgs = pkgsFor system;
          python = pkgs.mkShell {
            packages = [
              pkgs.python3
              pkgs.python3Packages.setuptools
            ];
          };
          typescript = pkgs.mkShell {
            packages = [
              pkgs.esbuild
              pkgs.nodejs_24
            ];
          };
        in
        {
          default = pkgs.mkShell {
            inputsFrom = [
              python
              typescript
            ];
          };
          inherit python typescript;
        }
      );

      formatter = forAllSystems (system: (pkgsFor system).nixfmt-rfc-style);

      nixosModules.pep-health = import ./nix/modules/pep-health.nix;

      nixosConfigurations.prototype = nixpkgs.lib.nixosSystem {
        system = "x86_64-linux";
        specialArgs.pepPythonService = packageSets.x86_64-linux.python-service;
        modules = [ ./nix/hosts/prototype.nix ];
      };
    };
}
