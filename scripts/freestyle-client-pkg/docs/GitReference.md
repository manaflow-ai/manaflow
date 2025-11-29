# GitReference

A reference to a Git object

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**name** | **str** | The name of the ref (e.g., \&quot;refs/heads/main\&quot; or \&quot;refs/tags/v1.0.0\&quot;) | 
**sha** | **str** | The SHA-1 hash of the Git object this reference points to | 

## Example

```python
from freestyle_client.models.git_reference import GitReference

# TODO update the JSON string below
json = "{}"
# create an instance of GitReference from a JSON string
git_reference_instance = GitReference.from_json(json)
# print the JSON string representation of the object
print(GitReference.to_json())

# convert the object into a dict
git_reference_dict = git_reference_instance.to_dict()
# create an instance of GitReference from a dict
git_reference_from_dict = GitReference.from_dict(git_reference_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


