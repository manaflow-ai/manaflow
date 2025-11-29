# BlobObject

Blob object

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**content** | **str** | The content of the blob, base64 encoded. | 
**encoding** | [**BlobEncoding**](BlobEncoding.md) | The encoding of the blob. Always &#x60;base64&#x60;. | 
**sha** | **str** | The object&#39;s hash. | 
**size** | **int** | The blob&#39;s size in bytes | 

## Example

```python
from freestyle_client.models.blob_object import BlobObject

# TODO update the JSON string below
json = "{}"
# create an instance of BlobObject from a JSON string
blob_object_instance = BlobObject.from_json(json)
# print the JSON string representation of the object
print(BlobObject.to_json())

# convert the object into a dict
blob_object_dict = blob_object_instance.to_dict()
# create an instance of BlobObject from a dict
blob_object_from_dict = BlobObject.from_dict(blob_object_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


