from setuptools import find_packages, setup


setup(
    name="pep-python-service",
    version="0.1.0",
    description="Python system-service boundary prototype",
    packages=find_packages(where="src"),
    package_dir={"": "src"},
    python_requires=">=3.12",
    entry_points={
        "console_scripts": ["pep-python-service=pep_health.server:main"],
    },
)
